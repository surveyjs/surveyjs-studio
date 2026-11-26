import { pathToFileURL } from "node:url";
import { runBackup, runRestore } from "./backup.js";
import { describeUnexpected, type CliEnv, type CliIo } from "./common.js";
import { run as runDb } from "./db.js";
import { run as runPurge } from "./purge-deleted-responses.js";
import { run as runRebaseUrls } from "./rebase-urls.js";
import { run as runS3Bucket } from "./s3-bucket.js";

/** The hosted edition's command; the self-hosted image (`APP_EDITION=self-hosted`) neither lists nor runs it. */
const MIGRATE_HOSTED = `  migrate-hosted <command> [options]
                                  The hosted edition only: copy the legacy data into this
                                  database (plan, copy, verify, delta, reconcile, wipe); see
                                  migrate-hosted --help
`;

export const USAGE = `Usage: surveyjs-studio <command> [options]

The operator commands of SurveyJS Studio (on the image's PATH; in the repository:
node --import tsx server/src/cli/surveyjs-studio.ts). They read the same environment variables
as the server.

Commands:
  backup [--to <dir>]             Copy the SQLite database and the local files into a new folder
  restore <dir> [--replace]       Restore a backup folder (stop the server first)
  migrate                         Apply the database migrations the database lacks
  status                          List the applied and the pending database migrations
  seed                            Migrate, then load the shared seed (the golden fixtures)
  s3-bucket create|remove <name>  Create or remove a bucket on an S3 server
  rebase-urls --from <url> --to <url> [--yes]
                                  Point stored file URLs at a new PUBLIC_BASE_URL
  purge-deleted-responses --before <date> [--apply]
                                  Delete the archived copies of deleted responses (a dry run
                                  without --apply; SQL providers only)
${MIGRATE_HOSTED}
Run surveyjs-studio <command> --help for a command's options.

Exit codes: 0 success, 1 failure, 2 usage error`;

/** The usage for the environment: without migrate-hosted in the self-hosted edition. */
export const usage = (env: CliEnv): string =>
  env.APP_EDITION === "self-hosted" ? USAGE.replace(MIGRATE_HOSTED, "") : USAGE;

type MigrateHostedRun = (
  argv: readonly string[],
  io: CliIo,
  deps: { env?: CliEnv },
) => Promise<number>;

export interface SurveyjsStudioDeps {
  /** Default `process.env` (never changed). */
  readonly env?: CliEnv;
  /** Default: imports `../migrate/cli.js` (absent from the self-hosted image). Tests only. */
  readonly loadMigrateHosted?: () => Promise<{ run: MigrateHostedRun }>;
}

const HOSTED_ONLY = "migrate-hosted is part of the hosted edition only.\n";

/** Runs one subcommand. Returns the exit code; never throws. */
export async function run(
  argv: readonly string[],
  io: CliIo,
  deps: SurveyjsStudioDeps = {},
): Promise<number> {
  const [command, ...rest] = argv;
  const text = usage(deps.env ?? process.env);
  if (command === "--help") {
    io.out(text + "\n");
    return 0;
  }
  switch (command) {
    case "backup":
      return runBackup(rest, io, deps);
    case "restore":
      return runRestore(rest, io, deps);
    case "migrate":
    case "status":
    case "seed":
      return runDb([command, ...rest], io, deps);
    case "rebase-urls":
      return runRebaseUrls(rest, io, deps);
    case "purge-deleted-responses":
      return runPurge(rest, io, deps);
    case "migrate-hosted": {
      if ((deps.env ?? process.env).APP_EDITION === "self-hosted") {
        io.err(HOSTED_ONLY);
        return 2;
      }
      // Loaded only when asked for: the other commands need none of the legacy store clients.
      let runMigrateHosted: MigrateHostedRun;
      try {
        ({ run: runMigrateHosted } = await (
          deps.loadMigrateHosted ?? (() => import("../migrate/cli.js"))
        )());
      } catch (error) {
        // The self-hosted image removes the tool, whatever APP_EDITION it is started with.
        if ((error as { code?: unknown } | null)?.code === "ERR_MODULE_NOT_FOUND") {
          io.err(HOSTED_ONLY);
          return 2;
        }
        io.err(`Error: ${describeUnexpected(error)}\n`);
        return 1;
      }
      return runMigrateHosted(rest, io, { ...(deps.env !== undefined && { env: deps.env }) });
    }
    case "s3-bucket":
      return runS3Bucket(rest, io, { ...(deps.env ?? process.env) });
    case undefined:
      io.err(`${text}\n`);
      return 2;
    default:
      io.err(`Unknown command: ${command}\n\n${text}\n`);
      return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
