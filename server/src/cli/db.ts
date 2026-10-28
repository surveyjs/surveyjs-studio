import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";
import { openDatabase, type DatabaseTarget, type SqlDatabase } from "../sql/database.js";
import { legacyFixtureSeed } from "../providers/azure-legacy/fixtures.js";
import { DatabaseTooNewError, migrate, migrationStatus } from "../sql/migrator.js";
import { seedSqlStores } from "../sql/seed.js";
import { parseFlags, safeErrorText, withEnvFile, type CliEnv, type CliIo } from "./common.js";

export const USAGE = `Usage: pnpm db:migrate [--env-file <path>]
       pnpm db:status [--env-file <path>]
       pnpm seed [--env-file <path>]

db:migrate applies the database migrations this version has and the database lacks, in one
transaction (the server also does this when it starts). db:status lists the applied and the
pending migrations, and writes nothing. seed migrates, then loads the shared seed (the golden
fixtures): each seed survey is replaced, every other survey stays. STORAGE_PROVIDER must be
sqlite or postgres (for the local PostgreSQL pass --env-file docker/postgres.env).

Options:
  --env-file <path>   Load environment variables from this file first;
                      variables already set in the environment win
  --help              Show this text

With READ_ONLY=true, db:migrate and seed are refused (exit 2).

Exit codes: 0 success, 1 database error or a database a newer version migrated, 2 usage error,
no SQL storage provider or READ_ONLY=true with db:migrate or seed`;

export interface DbCommandDeps {
  /** Default `process.env` (never changed: `--env-file` values go into a copy). */
  readonly env?: CliEnv;
}

const label = (m: { version: number; name: string }) =>
  `${String(m.version).padStart(4, "0")}-${m.name}`;

/** Where the database is, for people: the SQLite file, or PostgreSQL's host, port and name. */
export function describeTarget(target: DatabaseTarget): string {
  if (target.dialect === "sqlite") return `sqlite, ${target.path}`;
  const url = new URL(target.url);
  return `postgres, ${url.hostname}:${url.port || "5432"}${url.pathname}`;
}

async function status(database: SqlDatabase, io: CliIo): Promise<number> {
  const { applied, pending, unknown } = await migrationStatus(database);
  const known = applied.filter((m) => !unknown.includes(m));
  io.out(
    known.length === 0
      ? "Applied: none\n"
      : `Applied:\n${known.map((m) => `  ${label(m)}  ${m.appliedAt}\n`).join("")}`,
  );
  io.out(
    pending.length === 0
      ? "Pending: none\n"
      : `Pending:\n${pending.map((m) => `  ${label(m)}\n`).join("")}`,
  );
  if (unknown.length === 0) return 0;
  io.out(`Applied by a newer version:\n${unknown.map((m) => `  ${label(m)}\n`).join("")}`);
  io.err(`${new DatabaseTooNewError(unknown[0]!).message}\n`);
  return 1;
}

async function apply(database: SqlDatabase, io: CliIo): Promise<number> {
  const { applied } = await migrate(database);
  io.out(
    applied.length === 0
      ? "Nothing to apply: the database is up to date.\n"
      : `Applied ${applied.length} migration${applied.length === 1 ? "" : "s"}: ${applied.map(label).join(", ")}\n`,
  );
  return 0;
}

async function seed(database: SqlDatabase, io: CliIo): Promise<number> {
  await apply(database, io);
  const report = await seedSqlStores(database, await legacyFixtureSeed());
  io.out(`Seeded ${report.surveys} surveys.\n`);
  return 0;
}

const COMMANDS = ["migrate", "status", "seed"] as const;
type Command = (typeof COMMANDS)[number];

/** How the providers without a database load the shared seed. */
const SEED_ELSEWHERE: Partial<Record<string, string>> = {
  memory: "memory loads the seed at start-up with MEMORY_SEED=legacy-fixtures.",
  "azure-legacy": "azure-legacy loads it into the local replica with pnpm legacy:load.",
};

/** Runs `migrate`, `status` or `seed`. Returns the exit code; never throws. */
export async function run(
  argv: readonly string[],
  io: CliIo,
  deps: DbCommandDeps = {},
): Promise<number> {
  const [first, ...rest] = argv;
  if (first === "--help" || rest.includes("--help")) {
    io.out(USAGE + "\n");
    return 0;
  }
  const command = COMMANDS.find((name) => name === first) as Command | undefined;
  if (command === undefined) {
    io.err(`Unknown command: ${first ?? "(none)"}\n\n${USAGE}\n`);
    return 2;
  }
  const flags = parseFlags(rest, { options: ["--env-file"], switches: [] });
  if (flags.kind === "usage-error") {
    io.err(`${flags.message}\n\n${USAGE}\n`);
    return 2;
  }
  let env: CliEnv = deps.env ?? process.env;
  const envFile = flags.kind === "run" ? flags.values["--env-file"] : undefined;
  if (envFile !== undefined) {
    const loaded = withEnvFile(env, envFile);
    if (loaded === null) {
      io.err(`Cannot read the env file: ${envFile}\n`);
      return 2;
    }
    env = loaded;
  }
  const provider = env.STORAGE_PROVIDER?.trim();
  if (provider !== "sqlite" && provider !== "postgres") {
    const elsewhere = command === "seed" ? SEED_ELSEWHERE[provider ?? "memory"] : undefined;
    io.err(
      `STORAGE_PROVIDER must be sqlite or postgres: no other provider has a database.${elsewhere ? ` ${elsewhere}` : ""}\n`,
    );
    return 2;
  }
  let database: SqlDatabase | null = null;
  try {
    const config = loadConfig({ ...env }, { skipIdentityRules: true });
    if (command !== "status" && config.readOnly) {
      io.err(
        `Refused: READ_ONLY=true. Nothing was ${command === "seed" ? "seeded" : "migrated"}.\n`,
      );
      return 2;
    }
    database = openDatabase(config.database!);
    io.out(`Database: ${describeTarget(config.database!)}\n`);
    if (command === "seed") return await seed(database, io);
    return command === "migrate" ? await apply(database, io) : await status(database, io);
  } catch (error) {
    io.err(`Error: ${safeErrorText(error)}\n`);
    return 1;
  } finally {
    if (database) await database.close().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
