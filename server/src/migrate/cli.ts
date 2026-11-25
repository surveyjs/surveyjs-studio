/**
 * `migrate:hosted <command>`: the hosted migration tool's command line (design, Decisions). The
 * source (the legacy stores) is only read; the target is Studio's own database and file store.
 *
 *   plan | copy | verify | delta | reconcile | wipe
 *
 * Output is counts and ids, never content (rule 6): the summary on stdout, the full report (ids
 * and counts) where `--report` points, the inspection dump (full records) where `--dump` points.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { openByteStore, type ByteStore } from "../bytes/index.js";
import { parseFlags, safeErrorText, withEnvFile, type CliEnv, type CliIo } from "../cli/common.js";
import { ConfigError, loadConfig, type LegacyConfig } from "../config.js";
import { LEGACY_VARIABLES } from "../legacy/endpoint-guard.js";
import { measureLegacyStores } from "../legacy/stats-source.js";
import { createAzureLegacyProviders } from "../providers/azure-legacy/index.js";
import { createSqlProviders } from "../providers/sql.js";
import { openDatabase, type SqlDatabase } from "../sql/database.js";
import { migrate } from "../sql/migrator.js";
import { runCopy } from "./copy.js";
import { runDelta } from "./delta.js";
import { openDumpWriter, type DumpWriter } from "./dump.js";
import { createReport, type Report } from "./map/report.js";
import { runPlan } from "./plan.js";
import { runReconcile } from "./reconcile.js";
import { selectSample, type SampleSet } from "./sample.js";
import { openLegacySource, type LegacySource } from "./source/index.js";
import type { ListingShareReader } from "./source/shares.js";
import { Refused } from "./state.js";
import { openMigrationTarget } from "./target.js";
import { runVerify } from "./verify.js";
import { WipeRefused, wipeTarget } from "./wipe.js";

export const USAGE = `Usage: surveyjs-studio migrate-hosted <command> [options]

Copies the legacy surveyjs.io data into Studio's database and file store, checks the copy, and
keeps it current until the cutover. The legacy stores are only read. Output is counts and ids,
never content; in the repository the command is pnpm migrate:hosted.

Commands:
  plan        Count what a copy would move and estimate its size; writes nothing
  copy        Copy everything (or a sample); a stopped run is resumed by running it again
  verify      Compare the target with the source as of the copy's high-water marks
              (incremental; --full compares everything). Exit 1 on any difference
  delta       Copy what changed in the source since the last copy or delta
  reconcile   Remove from the target what the source deleted, and re-map changed surveys
  wipe        Empty the target: every table but schema_migrations and every stored file

Options:
  --source <env file>   The legacy stores: LEGACY_SQL_CONNECTION_STRING,
                        LEGACY_SURVEYS_STORAGE_CONNECTION_STRING and
                        LEGACY_RESULTS_STORAGE_CONNECTION_STRING; read from the environment
                        when not given (variables already set win over the file)
  --target <env file>   The target: STORAGE_PROVIDER (sqlite or postgres), SQLITE_PATH or
                        DATABASE_URL, FILE_STORE, FILES_PATH or S3_*; the environment is not
                        used. Needed by verify, delta, reconcile and wipe. copy without it uses a
                        scratch SQLite database and files folder in a new temporary
                        folder, which is printed and left in place
  --sample <share>      Only a share (0 to 1) of the accounts, chosen by a hash of the account id,
                        with their projects (plan, copy, verify, delta, reconcile)
  --include <file>      Accounts always in the sample: a file of account ids (one per line)
  --report <path>       Write the report (ids and counts) as JSON to this file
  --dump <dir>          copy, delta: also write every record, in full, as NDJSON in this folder
                        (full records: private data when the source is production)
  --full                copy: copy surveys again that were copied; verify: compare everything;
                        reconcile: also count every survey's responses
  --deep-sample <n>     verify --full: surveys compared response by response (default 20)
  --deep-max-responses <n>
                        verify: skip that walk for a survey with more responses (default 50000)
  --confirm <name>      wipe: the target's name (the PostgreSQL database name, or the SQLite
                        file's name); wipe refuses without it and without --target
  --help                Show this text

verify, delta and reconcile refuse (exit 2) a --sample or --include other than the copy's;
delta and reconcile refuse a target whose copy has not finished. The report and the progress
lines give each phase's duration.

Exit codes: 0 done or green, 1 failed or differences found, 2 usage error or refused`;

const COMMANDS = ["plan", "copy", "verify", "delta", "reconcile", "wipe"] as const;
export type Command = (typeof COMMANDS)[number];

const OPTIONS = [
  "--source",
  "--target",
  "--sample",
  "--include",
  "--report",
  "--dump",
  "--deep-sample",
  "--deep-max-responses",
  "--confirm",
];

export type ParsedArgs =
  | {
      kind: "run";
      command: Command;
      source: string | null;
      target: string | null;
      sample: number | null;
      include: string | null;
      report: string | null;
      dump: string | null;
      full: boolean;
      deepSample: number | null;
      deepMaxResponses: number | null;
      confirm: string | null;
    }
  | { kind: "help" }
  | { kind: "usage-error"; message: string };

/** The command: the first argument that is neither a flag nor a flag's value; -1 for none. */
function commandIndex(argv: readonly string[]): number {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") continue;
    if (OPTIONS.includes(arg)) i++;
    else if (!arg.startsWith("--")) return i;
  }
  return -1;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const at = commandIndex(argv);
  const parsed = parseFlags(
    argv.filter((_, i) => i !== at),
    { options: OPTIONS, switches: ["--full"] },
  );
  if (parsed.kind !== "run") return parsed;
  const command = argv[at];
  if (command === undefined) return { kind: "usage-error", message: "Missing command" };
  if (!(COMMANDS as readonly string[]).includes(command)) {
    return { kind: "usage-error", message: `Unknown command: ${command}` };
  }
  const number = (flag: string, whole: boolean): number | null | "bad" => {
    const text = parsed.values[flag]?.trim();
    if (text === undefined) return null;
    const value = Number(text);
    if (text === "" || !Number.isFinite(value) || (whole && !Number.isInteger(value))) return "bad";
    return value;
  };
  const sample = number("--sample", false);
  if (sample === "bad" || (sample !== null && (sample < 0 || sample > 1))) {
    return { kind: "usage-error", message: "--sample must be a number from 0 to 1" };
  }
  const deepSample = number("--deep-sample", true);
  if (deepSample === "bad" || (deepSample !== null && deepSample < 0)) {
    return { kind: "usage-error", message: "--deep-sample must be a whole number, 0 or more" };
  }
  const deepMax = number("--deep-max-responses", true);
  if (deepMax === "bad" || (deepMax !== null && deepMax < 1)) {
    return {
      kind: "usage-error",
      message: "--deep-max-responses must be a whole number, 1 or more",
    };
  }
  const value = (flag: string) => parsed.values[flag] ?? null;
  return {
    kind: "run",
    command: command as Command,
    source: value("--source"),
    target: value("--target"),
    sample,
    include: value("--include"),
    report: value("--report"),
    dump: value("--dump"),
    full: parsed.switches.has("--full"),
    deepSample,
    deepMaxResponses: deepMax,
    confirm: value("--confirm"),
  };
}

/** A target as the tool uses it. */
export interface OpenedTarget {
  database: SqlDatabase;
  bytes: ByteStore;
  /** The local file store's folder; null for S3. */
  localRoot: string | null;
  /** What `wipe --confirm` must say. */
  name: string;
  /** A SQLite file that does not exist (wipe refuses it rather than create one). */
  missing: boolean;
}

export interface MigrateDeps {
  /** Default `process.env`; the source settings come from it (and `--source`). */
  env?: CliEnv;
  /** Default `openLegacySource` with `shares`. */
  openSource?: (legacy: LegacyConfig) => LegacySource;
  /** Default: the database and file store the `--target` file's settings name. */
  openTarget?: (env: Readonly<Record<string, string | undefined>>) => OpenedTarget;
  /** The legacy file shares; undefined: the real ones (the local replica has none: a stub). */
  shares?: ListingShareReader | null;
}

function openFromSettings(env: Readonly<Record<string, string | undefined>>): OpenedTarget {
  const config = loadConfig({ ...env }, { skipIdentityRules: true });
  if (
    (config.storageProvider !== "sqlite" && config.storageProvider !== "postgres") ||
    config.database === null ||
    config.files === null
  ) {
    throw new ConfigError("STORAGE_PROVIDER: the target must be sqlite or postgres");
  }
  const database = openDatabase(config.database);
  const bytes = openByteStore(config.files);
  const localRoot = config.files.kind === "local" ? config.files.path : null;
  if (config.database.dialect === "sqlite") {
    const { path } = config.database;
    return {
      database,
      bytes,
      localRoot,
      name: basename(path),
      missing: path !== ":memory:" && !existsSync(path),
    };
  }
  const name = decodeURIComponent(new URL(config.database.url).pathname.replace(/^\//, ""));
  return { database, bytes, localRoot, name, missing: false };
}

/** A scratch target in a new temporary folder. */
function openScratch(): { opened: OpenedTarget; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "surveyjs-studio-migrate-"));
  const files = join(dir, "files");
  return {
    dir,
    opened: {
      database: openDatabase({ dialect: "sqlite", path: join(dir, "target.db") }),
      bytes: openByteStore({ kind: "local", path: files }),
      localRoot: files,
      name: "target.db",
      missing: false,
    },
  };
}

const lines = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, n]) => `  ${key}: ${n}\n`)
    .join("");

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Runs the command. Returns the exit code; never throws. */
export async function run(
  argv: readonly string[],
  io: CliIo,
  deps: MigrateDeps = {},
): Promise<number> {
  const args = parseArgs(argv.includes("--help") ? ["--help"] : argv);
  if (args.kind === "help") {
    io.out(USAGE + "\n");
    return 0;
  }
  if (args.kind === "usage-error") {
    io.err(`${args.message}\n\n${USAGE}\n`);
    return 2;
  }
  const usage = (message: string) => {
    io.err(`${message}\n`);
    return 2;
  };
  const { command } = args;

  // Everything that can be wrong with the arguments is found before anything is opened.
  if (command === "wipe") {
    if (args.target === null) return usage("wipe needs --target: it never wipes a scratch target.");
    if (args.confirm === null) {
      return usage(
        "wipe needs --confirm <target name> (the database name or the SQLite file name).",
      );
    }
  }
  if (
    args.target === null &&
    (command === "verify" || command === "delta" || command === "reconcile")
  ) {
    return usage(
      `${command} needs --target: it works on what a copy already put there, and a scratch target is empty.`,
    );
  }
  let include: string[] = [];
  if (args.include !== null) {
    try {
      include = readFileSync(args.include, "utf8")
        .split(/[\s,]+/)
        .filter((id) => id !== "");
    } catch {
      return usage(`Cannot read the include file: ${args.include}`);
    }
  }
  let targetEnv: Record<string, string | undefined> | null = null;
  if (args.target !== null) {
    targetEnv = withEnvFile({}, args.target);
    if (targetEnv === null) return usage(`Cannot read the env file: ${args.target}`);
  }
  let legacy: LegacyConfig | null = null;
  if (command !== "wipe") {
    let env: CliEnv = deps.env ?? process.env;
    if (args.source !== null) {
      const loaded = withEnvFile(env, args.source);
      if (loaded === null) return usage(`Cannot read the env file: ${args.source}`);
      env = loaded;
    }
    const missing = LEGACY_VARIABLES.filter((name) => !env[name]?.trim());
    if (missing.length > 0) {
      return usage(
        `Not set: ${missing.join(", ")}. Set them, or pass --source <env file> ` +
          "(docker/azurite.env for the local replica).",
      );
    }
    legacy = {
      sqlConnectionString: env.LEGACY_SQL_CONNECTION_STRING!.trim(),
      surveysStorageConnectionString: env.LEGACY_SURVEYS_STORAGE_CONNECTION_STRING!.trim(),
      resultsStorageConnectionString: env.LEGACY_RESULTS_STORAGE_CONNECTION_STRING!.trim(),
    };
  }

  const report: Report = createReport();
  let opened: OpenedTarget | null = null;
  let source: LegacySource | null = null;
  let dump: DumpWriter | null = null;
  let databaseClosed = false;
  try {
    if (command !== "plan") {
      if (targetEnv !== null) {
        opened = (deps.openTarget ?? openFromSettings)(targetEnv);
      } else {
        const scratch = openScratch();
        opened = scratch.opened;
        io.out(
          `No --target: using a scratch target in ${scratch.dir} (target.db and files/); ` +
            "it is left in place, delete the folder when done.\n",
        );
      }
    }

    if (command === "wipe") {
      const target = opened!;
      if (target.name !== args.confirm) {
        return usage(
          `Refused: --confirm does not match the target's name (${target.name}). ` +
            "Nothing was changed.",
        );
      }
      if (target.missing) {
        return usage(`Refused: the target database ${target.name} does not exist.`);
      }
      const result = await wipeTarget(target.database, target.bytes, {
        localRoot: target.localRoot,
      });
      io.out(
        `Wiped ${target.name}: ${result.rows} rows in ${result.tables} tables, ` +
          `${result.files} stored files deleted` +
          (result.strayFiles === null
            ? " (S3: only the files the database names; other objects in the bucket are not listed or touched)"
            : `, ${result.strayFiles} stray files under the folder removed`) +
          ".\n",
      );
      return 0;
    }

    if (opened !== null) await migrate(opened.database);
    source = (deps.openSource ?? ((l) => openLegacySource(l, { shares: deps.shares })))(legacy!);

    let sample: SampleSet | undefined;
    if (args.sample !== null || args.include !== null) {
      sample = await selectSample(source, args.sample ?? 0, include, report);
      io.out(
        `Sample: ${sample.accounts.size} accounts, ${sample.projects.size} projects, ` +
          `${sample.surveys.size} surveys.\n`,
      );
    }
    const progress = (line: string) => io.err(`${line}\n`);
    if (args.dump !== null && (command === "copy" || command === "delta")) {
      dump = openDumpWriter(args.dump);
    }
    const sampled = sample ? { sample } : {};
    const dumped = dump ? { dump } : {};

    if (command === "plan") {
      const plan = await runPlan(source, {
        ...sampled,
        measure: () => measureLegacyStores(legacy!, { resultBytes: false, progress }),
      });
      const v = plan.volumes;
      io.out(
        `Plan: ${v.users} users (${v.usersWithAccessKey} with an access key), ` +
          `${v.surveys} surveys, ${v.projects} projects, ${v.members} members.\n`,
      );
      if (plan.sample) {
        io.out(
          `Plan sample: ${plan.sample.surveys.length} surveys, ` +
            `${plan.sample.keyHashes.length} access keys.\n`,
        );
      }
      if (plan.estimate) io.out(`Estimate: ${JSON.stringify(plan.estimate)}\n`);
      if (args.report !== null) writeJson(args.report, { plan, ...(report.toJSON() as object) });
      return 0;
    }

    const target = openMigrationTarget(opened!.database, opened!.bytes);
    let ok = true;
    if (command === "copy") {
      await runCopy(source, target, { report, ...sampled, ...dumped, full: args.full, progress });
    } else if (command === "delta") {
      await runDelta(source, target, { report, ...sampled, ...dumped, progress });
    } else if (command === "reconcile") {
      await runReconcile(source, target, { report, ...sampled, full: args.full, progress });
    } else {
      const sourceProviders = createAzureLegacyProviders(legacy!, {
        ...(deps.shares !== undefined && { legacyShares: deps.shares }),
      });
      const targetProviders = createSqlProviders(opened!.database, {
        bytes: opened!.bytes,
        localAccounts: true,
      });
      try {
        ({ ok } = await runVerify(source, sourceProviders, targetProviders, target, {
          full: args.full,
          ...sampled,
          deepSample: args.deepSample ?? 20,
          ...(args.deepMaxResponses !== null && { deepMaxResponses: args.deepMaxResponses }),
          report,
          progress,
        }));
      } finally {
        await sourceProviders.close().catch(() => undefined);
        // Closes the target's database too.
        await targetProviders.close().catch(() => undefined);
        databaseClosed = true;
      }
    }

    const counts = report.counts();
    const differences = Object.entries(counts)
      .filter(([key]) => key.startsWith("difference:"))
      .reduce((sum, [, n]) => sum + n, 0);
    io.out(
      command === "verify"
        ? `verify${args.full ? " --full" : ""}: ${ok ? "OK" : "FAILED"}, ${differences} differences\n`
        : `${command}: done\n`,
    );
    if (Object.keys(counts).length > 0) io.out(`Report counts:\n${lines(counts)}`);
    if (args.report !== null) {
      writeJson(args.report, report.toJSON());
      io.out(`Report written to ${args.report}\n`);
    }
    return ok ? 0 : 1;
  } catch (error) {
    if (error instanceof WipeRefused) return usage(`Refused: ${error.message}`);
    if (error instanceof Refused) return usage(`Refused: ${error.message}. Nothing was changed.`);
    if (error instanceof ConfigError) return usage(`Error: ${error.message}`);
    io.err(`Error: ${safeErrorText(error)}\n`);
    return 1;
  } finally {
    await dump?.close().catch(() => undefined);
    await source?.close().catch(() => undefined);
    if (opened !== null && !databaseClosed) await opened.database.close().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
