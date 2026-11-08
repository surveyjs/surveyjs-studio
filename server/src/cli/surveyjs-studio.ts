import { pathToFileURL } from "node:url";
import { runBackup, runRestore } from "./backup.js";
import type { CliEnv, CliIo } from "./common.js";
import { run as runDb } from "./db.js";
import { run as runS3Bucket } from "./s3-bucket.js";

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

Run surveyjs-studio <command> --help for a command's options.

Exit codes: 0 success, 1 failure, 2 usage error`;

export interface SurveyjsStudioDeps {
  /** Default `process.env` (never changed). */
  readonly env?: CliEnv;
}

/** Runs one subcommand. Returns the exit code; never throws. */
export async function run(
  argv: readonly string[],
  io: CliIo,
  deps: SurveyjsStudioDeps = {},
): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "--help") {
    io.out(USAGE + "\n");
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
    case "s3-bucket":
      return runS3Bucket(rest, io, { ...(deps.env ?? process.env) });
    case undefined:
      io.err(`${USAGE}\n`);
      return 2;
    default:
      io.err(`Unknown command: ${command}\n\n${USAGE}\n`);
      return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
