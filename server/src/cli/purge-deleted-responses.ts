import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";
import { openDatabase, type SqlDatabase } from "../sql/database.js";
import { isoOf } from "../sql/values.js";
import {
  parseFlags,
  safeErrorText,
  withEnvFile,
  type CliEnv,
  type CliIo,
  type StoreCommandDeps,
} from "./common.js";

export const USAGE = `Usage: surveyjs-studio purge-deleted-responses --before <date> [--apply] [--env-file <path>]

Purges the archived copies of deleted responses (the deleted_responses table) that were deleted
strictly before the given instant. A dry run by default: it counts the copies and deletes nothing.
Prints counts and the date only. STORAGE_PROVIDER must be sqlite or postgres. In the repository the
command is pnpm purge:deleted-responses.

Options:
  --before <date>     Delete copies archived before this instant, an ISO 8601 date or date and
                      time (a date alone is midnight UTC) (required)
  --apply             Delete the copies; without it the command only counts them
  --env-file <path>   Load environment variables from this file first;
                      variables already set in the environment win
  --help              Show this text

With READ_ONLY=true, --apply is refused (exit 2).

Exit codes: 0 success, 1 a provider without a database or a database error, 2 usage error or
READ_ONLY=true with --apply`;

/** Printed with READ_ONLY=true and --apply. */
export const READ_ONLY_PURGE = "Refused: READ_ONLY=true. Nothing was deleted.";

export type ParsedArgs =
  | { kind: "run"; before: string; apply: boolean; envFile: string | null }
  | { kind: "help" }
  | { kind: "usage-error"; message: string };

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed = parseFlags(argv, {
    options: ["--before", "--env-file"],
    switches: ["--apply"],
  });
  if (parsed.kind !== "run") return parsed;
  const before = parsed.values["--before"]?.trim();
  if (!before) return { kind: "usage-error", message: "--before is required" };
  if (Number.isNaN(Date.parse(before))) {
    return { kind: "usage-error", message: "--before must be an ISO 8601 date or date and time" };
  }
  return {
    kind: "run",
    before,
    apply: parsed.switches.has("--apply"),
    envFile: parsed.values["--env-file"] ?? null,
  };
}

async function countBefore(database: SqlDatabase, instant: string): Promise<number> {
  const row = await database.db
    .selectFrom("deleted_responses")
    .select((eb) => eb.fn.countAll().as("n"))
    .where("deleted_at", "<", instant)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/** Runs the command. Returns the exit code; never throws. */
export async function run(
  argv: readonly string[],
  io: CliIo,
  deps: StoreCommandDeps = {},
): Promise<number> {
  const args = parseArgs(argv);
  if (args.kind === "help") {
    io.out(USAGE + "\n");
    return 0;
  }
  if (args.kind === "usage-error") {
    io.err(`${args.message}\n\n${USAGE}\n`);
    return 2;
  }
  let env: CliEnv = deps.env ?? process.env;
  if (args.envFile !== null) {
    const loaded = withEnvFile(env, args.envFile);
    if (loaded === null) {
      io.err(`Cannot read the env file: ${args.envFile}\n`);
      return 2;
    }
    env = loaded;
  }
  const provider = env.STORAGE_PROVIDER?.trim();
  if (provider !== "sqlite" && provider !== "postgres") {
    io.err("Error: purge:deleted-responses needs STORAGE_PROVIDER=sqlite or postgres.\n");
    return 1;
  }
  const instant = isoOf(args.before);
  let database: SqlDatabase | null = null;
  try {
    const config = loadConfig({ ...env }, { skipIdentityRules: true });
    if (args.apply && config.readOnly) {
      io.err(`${READ_ONLY_PURGE}\n`);
      return 2;
    }
    database = openDatabase(config.database!);
    const n = await countBefore(database, instant);
    if (!args.apply) {
      io.out(
        `${n} deleted-response copies before ${instant}. Run again with --apply to delete them.\n`,
      );
      return 0;
    }
    const result = await database.db
      .deleteFrom("deleted_responses")
      .where("deleted_at", "<", instant)
      .executeTakeFirst();
    io.out(`Deleted ${Number(result.numDeletedRows)} deleted-response copies before ${instant}.\n`);
    return 0;
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
