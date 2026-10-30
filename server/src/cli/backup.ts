import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import {
  constants,
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { backup, DatabaseSync } from "node:sqlite";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadConfig, type AppConfig } from "../config.js";
import { openDatabase } from "../sql/database.js";
import { migrationStatus } from "../sql/migrator.js";
import { safeErrorText, withEnvFile, type CliEnv, type CliIo } from "./common.js";

export const BACKUP_USAGE = `Usage: surveyjs-studio backup [--to <dir>] [--env-file <path>]
       (in the repository: pnpm backup [--to <dir>] [--env-file <path>])

Copies the SQLite database (an online copy: the server may keep running) and the local files
(FILES_PATH) into a new folder <dir>/surveyjs-studio-YYYYMMDD-HHMMSSZ, with a backup.json that
describes it. The folder is written as <dir>/.partial-<name> and renamed when complete, so a
backup that did not finish never looks complete. STORAGE_PROVIDER must be sqlite; with
FILE_STORE=s3 the backup holds the database only (use bucket versioning for the files).

Options:
  --to <dir>          Where to put the backup folder; default: a backups folder next to the
                      database (/data/backups in the image)
  --env-file <path>   Load environment variables from this file first;
                      variables already set in the environment win
  --help              Show this text

Exit codes: 0 success, 1 file or database error (the unfinished folder is removed), 2 usage
error or a provider other than sqlite`;

export const RESTORE_USAGE = `Usage: surveyjs-studio restore <dir> [--replace] [--env-file <path>]
       (in the repository: pnpm restore <dir> [--replace] [--env-file <path>])

Restores a folder that backup wrote: the database to SQLITE_PATH, the files to FILES_PATH. Stop
the server first. Without --replace it refuses when SQLITE_PATH exists or FILES_PATH is not
empty. With --replace it moves the current database and files to a replaced-<timestamp> folder
next to the database (it never deletes them), then restores. The server migrates a backup of an
older version when it starts; it refuses one of a newer version.

Options:
  --replace           Move the current data aside first
  --env-file <path>   Load environment variables from this file first;
                      variables already set in the environment win
  --help              Show this text

Exit codes: 0 success, 1 file or database error, 2 usage error, not a complete backup, data in
the way without --replace, the database in use, or a provider other than sqlite`;

export interface BackupCommandDeps {
  /** Default `process.env` (never changed: `--env-file` values go into a copy). */
  readonly env?: CliEnv;
  /** Default `() => new Date()`: names the backup and the replaced folder. */
  readonly now?: () => Date;
}

const NOT_SQLITE =
  "backup covers SQLite and local files; for PostgreSQL use pg_dump (docs/self-hosting.md#backups)";
const FILES_IN_S3 = "files are in S3: use bucket versioning (docs/self-hosting.md#backups)";
const IN_USE = "the database is in use: stop the container first";

/** The database's name inside a backup folder. */
const DATABASE_FILE = "surveyjs-studio.db";
const MANIFEST_FILE = "backup.json";
const FILES_FOLDER = "files";
const FORMAT = 1;

/** SQLite's result codes for a lock another connection holds. */
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
/** How long restore waits for the database's lock before it calls it in use. */
const LOCK_TIMEOUT_MS = 1000;
/** Pages per backup step: all of them. A step that other connections' writes interrupt starts
 * the copy again, so a copy in small steps never ends while the server keeps writing; one step
 * reads one snapshot (WAL: writers do not wait for it). */
const ALL_PAGES = 2 ** 31 - 1;

/** The local byte store's temporary files (`{file}.{12 hex}.tmp`, bytes/local.ts). */
const BYTE_STORE_TEMPORARY = /\.[0-9a-f]{12}\.tmp$/;

interface Manifest {
  readonly format: number;
  readonly createdAt: string;
  readonly migration: number | null;
  readonly files: number;
  readonly bytes: number;
}

interface Copied {
  files: number;
  bytes: number;
}

/** `20261030-101500Z`: a UTC time for folder names. */
const stamp = (date: Date): string =>
  date
    .toISOString()
    .replace(/\.\d+Z$/, "Z")
    .replace(/[-:]/g, "")
    .replace("T", "-");

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const describeFiles = (c: Copied) => `${plural(c.files, "file")}, ${plural(c.bytes, "byte")}`;

const codeOf = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

/** Reads `--name value` options, `--name` switches and the positional arguments; `--` is skipped. */
function parseArgs(
  argv: readonly string[],
  spec: { readonly options: readonly string[]; readonly switches: readonly string[] },
):
  | {
      kind: "run";
      values: Partial<Record<string, string>>;
      switches: Set<string>;
      positional: string[];
    }
  | { kind: "help" }
  | { kind: "usage-error"; message: string } {
  if (argv.includes("--help")) return { kind: "help" };
  const values: Partial<Record<string, string>> = {};
  const switches = new Set<string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") continue;
    if (spec.options.includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return { kind: "usage-error", message: `${arg} needs a value` };
      }
      i++;
      values[arg] = value;
    } else if (spec.switches.includes(arg)) {
      switches.add(arg);
    } else if (arg.startsWith("-")) {
      return { kind: "usage-error", message: `Unknown argument: ${arg}` };
    } else {
      positional.push(arg);
    }
  }
  return { kind: "run", values, switches, positional };
}

/**
 * The configuration of a SQLite store, or the exit code: 2 for an unreadable env file or another
 * provider (with the message printed).
 */
function sqliteConfig(envFile: string | undefined, io: CliIo, deps: BackupCommandDeps) {
  let env: CliEnv = deps.env ?? process.env;
  if (envFile !== undefined) {
    const loaded = withEnvFile(env, envFile);
    if (loaded === null) {
      io.err(`Cannot read the env file: ${envFile}\n`);
      return 2;
    }
    env = loaded;
  }
  if (env.STORAGE_PROVIDER?.trim() !== "sqlite") {
    io.err(`${NOT_SQLITE}\n`);
    return 2;
  }
  const config: AppConfig = loadConfig({ ...env }, { skipIdentityRules: true });
  const database = config.database;
  if (database?.dialect !== "sqlite" || database.path === ":memory:") {
    io.err(`${NOT_SQLITE}\n`);
    return 2;
  }
  const files = config.files?.kind === "local" ? config.files.path : null;
  return { databasePath: database.path, filesPath: files };
}

/**
 * Copies the regular files under `from` into `to` (created), skipping the names `skip` matches.
 * A file or folder deleted while it runs is skipped: the database copy came first, and a row
 * whose bytes are gone reads as no file.
 */
async function copyTree(from: string, to: string, skip: RegExp | null): Promise<Copied> {
  const copied: Copied = { files: 0, bytes: 0 };
  await mkdir(to, { recursive: true });
  let entries;
  try {
    entries = await readdir(from, { withFileTypes: true });
  } catch (error) {
    if (codeOf(error) === "ENOENT") return copied;
    throw error;
  }
  for (const entry of entries) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      const inner = await copyTree(source, target, skip);
      copied.files += inner.files;
      copied.bytes += inner.bytes;
    } else if (entry.isFile() && !(skip?.test(entry.name) ?? false)) {
      try {
        await copyFile(source, target, constants.COPYFILE_EXCL);
      } catch (error) {
        if (codeOf(error) === "ENOENT" && !existsSync(source)) continue;
        throw error;
      }
      copied.files++;
      copied.bytes += (await stat(target)).size;
    }
  }
  return copied;
}

/** The latest migration the database at `path` has; null when it has none. */
async function latestMigration(path: string): Promise<number | null> {
  const database = openDatabase({ dialect: "sqlite", path });
  try {
    const { applied } = await migrationStatus(database);
    return applied.length === 0 ? null : Math.max(...applied.map((m) => m.version));
  } finally {
    await database.close();
  }
}

/** Runs `backup [--to <dir>]`. Returns the exit code; never throws. */
export async function runBackup(
  argv: readonly string[],
  io: CliIo,
  deps: BackupCommandDeps = {},
): Promise<number> {
  const args = parseArgs(argv, { options: ["--to", "--env-file"], switches: [] });
  if (args.kind === "help") {
    io.out(BACKUP_USAGE + "\n");
    return 0;
  }
  if (args.kind === "usage-error" || args.positional.length > 0) {
    const message =
      args.kind === "usage-error" ? args.message : `Unknown argument: ${args.positional[0]}`;
    io.err(`${message}\n\n${BACKUP_USAGE}\n`);
    return 2;
  }
  let partial: string | null = null;
  let stage = "the configuration";
  try {
    const target = sqliteConfig(args.values["--env-file"], io, deps);
    if (typeof target === "number") return target;
    const { databasePath, filesPath } = target;
    const folder = resolve(args.values["--to"] ?? join(dirname(databasePath), "backups"));
    if (filesPath !== null && isInside(folder, filesPath)) {
      io.err(`--to must not be inside FILES_PATH (${filesPath})\n`);
      return 2;
    }
    if (!existsSync(databasePath)) {
      io.err(`Error: there is no database at ${databasePath}\n`);
      return 1;
    }
    const now = (deps.now ?? (() => new Date()))();
    const name = `surveyjs-studio-${stamp(now)}`;
    const complete = join(folder, name);
    if (existsSync(complete)) {
      io.err(`Error: ${complete} exists\n`);
      return 1;
    }
    stage = "the backup folder";
    await mkdir(folder, { recursive: true });
    await mkdir(join(folder, `.partial-${name}`));
    partial = join(folder, `.partial-${name}`);

    // The database first, the files second: a file deleted in between leaves a row without
    // bytes, which reads as no file.
    stage = "the database copy";
    const source = new DatabaseSync(databasePath, { timeout: 5000 });
    try {
      await backup(source, join(partial, DATABASE_FILE), { rate: ALL_PAGES });
    } finally {
      source.close();
    }
    const migration = await latestMigration(join(partial, DATABASE_FILE));

    stage = "the files copy";
    const copied =
      filesPath === null
        ? { files: 0, bytes: 0 }
        : await copyTree(filesPath, join(partial, FILES_FOLDER), BYTE_STORE_TEMPORARY);

    stage = MANIFEST_FILE;
    const manifest: Manifest = {
      format: FORMAT,
      createdAt: now.toISOString(),
      migration,
      files: copied.files,
      bytes: copied.bytes,
    };
    await writeFile(join(partial, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
    await rename(partial, complete);
    partial = null;

    io.out(`Backed up to ${complete}\n`);
    io.out(`Database: migration ${migration ?? "none"}\n`);
    io.out(filesPath === null ? `Note: ${FILES_IN_S3}\n` : `Files: ${describeFiles(copied)}\n`);
    return 0;
  } catch (error) {
    io.err(`Error: ${stage} failed: ${safeErrorText(error)}\n`);
    return 1;
  } finally {
    if (partial !== null) await rm(partial, { recursive: true, force: true }).catch(() => {});
  }
}

/** Whether `path` is `folder` or inside it. */
function isInside(path: string, folder: string): boolean {
  const rel = relative(folder, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** The backup's manifest, or why the folder is not a backup this version restores. */
async function readManifest(folder: string): Promise<Manifest | string> {
  let manifest: Partial<Manifest>;
  try {
    manifest = JSON.parse(await readFile(join(folder, MANIFEST_FILE), "utf8")) as Partial<Manifest>;
  } catch {
    return `${folder} is not a complete backup: it has no readable ${MANIFEST_FILE}`;
  }
  if (manifest.format !== FORMAT) {
    return `${folder} is a backup of another format (${String(manifest.format)}); this version reads format ${FORMAT}`;
  }
  if (!existsSync(join(folder, DATABASE_FILE))) {
    return `${folder} is not a complete backup: it has no ${DATABASE_FILE}`;
  }
  return manifest as Manifest;
}

/**
 * Whether another connection has the database open. An exclusive lock (`BEGIN EXCLUSIVE` in
 * exclusive locking mode, waiting up to a second) is refused while any connection is open, not
 * only one that writes: in WAL mode an open connection keeps a shared lock on the file.
 */
function databaseInUse(path: string): boolean {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path, { timeout: LOCK_TIMEOUT_MS });
    db.exec("PRAGMA locking_mode = EXCLUSIVE;");
    db.exec("BEGIN EXCLUSIVE;");
    db.prepare("SELECT count(*) FROM sqlite_master").get();
    db.exec("ROLLBACK;");
    return false;
  } catch (error) {
    const code = (error as { errcode?: unknown }).errcode;
    if (code === SQLITE_BUSY || code === SQLITE_LOCKED) return true;
    throw error;
  } finally {
    db?.close();
  }
}

/** Moves `from` to `to`; across file systems a copy, then the original removed. */
async function move(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if (codeOf(error) !== "EXDEV") throw error;
    await cp(from, to, { recursive: true, errorOnExist: true, force: false });
    await rm(from, { recursive: true, force: true });
  }
}

/** Runs `restore <dir> [--replace]`. Returns the exit code; never throws. */
export async function runRestore(
  argv: readonly string[],
  io: CliIo,
  deps: BackupCommandDeps = {},
): Promise<number> {
  const args = parseArgs(argv, { options: ["--env-file"], switches: ["--replace"] });
  if (args.kind === "help") {
    io.out(RESTORE_USAGE + "\n");
    return 0;
  }
  if (args.kind === "usage-error" || args.positional.length !== 1) {
    const message =
      args.kind === "usage-error"
        ? args.message
        : args.positional.length === 0
          ? "restore needs the backup folder"
          : `Unknown argument: ${args.positional[1]}`;
    io.err(`${message}\n\n${RESTORE_USAGE}\n`);
    return 2;
  }
  const replace = args.switches.has("--replace");
  let replaced: string | null = null;
  let stage = "the configuration";
  try {
    const target = sqliteConfig(args.values["--env-file"], io, deps);
    if (typeof target === "number") return target;
    const { databasePath, filesPath } = target;
    const folder = resolve(args.positional[0]!);
    const manifest = await readManifest(folder);
    if (typeof manifest === "string") {
      io.err(`${manifest}\n`);
      return 2;
    }

    const databaseFiles = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
    const hasDatabase = databaseFiles.some((path) => existsSync(path));
    const currentFiles =
      filesPath === null ? [] : await readdir(filesPath).catch((): string[] => []);
    if ((hasDatabase || currentFiles.length > 0) && !replace) {
      io.err(
        `There is data in the way: ${hasDatabase ? databasePath : filesPath}. Pass --replace to ` +
          `move the current database and files to a replaced-<timestamp> folder first.\n`,
      );
      return 2;
    }
    stage = "the lock on the current database";
    if (existsSync(databasePath) && databaseInUse(databasePath)) {
      io.err(`${IN_USE}\n`);
      return 2;
    }

    if (hasDatabase || currentFiles.length > 0) {
      stage = "moving the current data aside";
      const now = (deps.now ?? (() => new Date()))();
      const aside = join(dirname(databasePath), `replaced-${stamp(now)}`);
      await mkdir(aside);
      replaced = aside;
      for (const path of databaseFiles) {
        if (existsSync(path)) await move(path, join(aside, basename(path)));
      }
      if (filesPath !== null && currentFiles.length > 0) {
        await mkdir(join(aside, FILES_FOLDER));
        for (const name of currentFiles) {
          await move(join(filesPath, name), join(aside, FILES_FOLDER, name));
        }
      }
      io.out(`Moved the current data to ${aside}\n`);
    }

    stage = "the database copy";
    await mkdir(dirname(databasePath), { recursive: true });
    const temporary = `${databasePath}.restore-${randomBytes(6).toString("hex")}.tmp`;
    try {
      await copyFile(join(folder, DATABASE_FILE), temporary, constants.COPYFILE_EXCL);
      await rename(temporary, databasePath);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }

    stage = "the files copy";
    const copied =
      filesPath === null ? null : await copyTree(join(folder, FILES_FOLDER), filesPath, null);

    io.out(`Restored ${folder}\n`);
    io.out(`Database: ${databasePath} (migration ${manifest.migration ?? "none"})\n`);
    io.out(
      copied === null
        ? `Note: ${FILES_IN_S3}\n`
        : `Files: ${describeFiles(copied)} in ${filesPath}\n`,
    );
    return 0;
  } catch (error) {
    const kept = replaced === null ? "" : ` (the data it replaced is in ${replaced})`;
    io.err(`Error: ${stage} failed: ${safeErrorText(error)}${kept}\n`);
    return 1;
  }
}
