import { pathToFileURL } from "node:url";
import { createEraseAccount } from "../accounts/erasure.js";
import { findErasureCandidates } from "../accounts/reconcile.js";
import { formatErased } from "./account-erase.js";
import {
  parseFlags,
  safeErrorText,
  withProviders,
  type CliIo,
  type StoreCommandDeps,
} from "./common.js";

export const USAGE = `Usage: pnpm account:reconcile [--apply] [--max <n>] [--env-file <path>]

Finds the user ids that own personal surveys or hold project memberships but that the user
directory does not know, and with --apply erases their data as account:erase does. Run it on a
schedule to catch an account-deleted webhook that never arrived. Without --apply it only lists
them. STORAGE_PROVIDER must name a persistent store (for the local replica pass
--env-file docker/azurite.env).

Options:
  --apply             Erase the listed ids; without it nothing is written
  --max <n>           Refuse to erase when more than n ids are listed (default 10)
  --env-file <path>   Load environment variables from this file first;
                      variables already set in the environment win
  --help              Show this text

With READ_ONLY=true, --apply is refused (exit 2); the dry run still works.

Exit codes: 0 success, 1 refused or store or directory error, 2 usage error, no persistent store
or READ_ONLY=true with --apply`;

const DEFAULT_MAX = 10;

export type ParsedArgs =
  | { kind: "run"; apply: boolean; max: number; envFile: string | null }
  | { kind: "help" }
  | { kind: "usage-error"; message: string };

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed = parseFlags(argv, { options: ["--max", "--env-file"], switches: ["--apply"] });
  if (parsed.kind !== "run") return parsed;
  const max = parsed.values["--max"] ?? String(DEFAULT_MAX);
  if (!/^[0-9]{1,9}$/.test(max) || Number(max) < 1) {
    return { kind: "usage-error", message: "--max must be a positive integer" };
  }
  return {
    kind: "run",
    apply: parsed.switches.has("--apply"),
    max: Number(max),
    envFile: parsed.values["--env-file"] ?? null,
  };
}

/** Runs the command. Returns the exit code; never throws. Writes only with `--apply`. */
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
  const now = deps.now ?? Date.now;
  return withProviders(args.envFile, io, deps, { writes: args.apply }, async (providers) => {
    // A directory failure rejects here: nothing is erased.
    const candidates = await findErasureCandidates(providers);
    io.out(`Users the directory does not know: ${candidates.length}\n`);
    for (const id of candidates) io.out(`  ${id}\n`);
    if (candidates.length === 0) {
      io.out("Nothing to erase.\n");
      return 0;
    }
    if (!args.apply) {
      io.out(
        "These are owner ids the directory does not know, not necessarily people: the id of a " +
          "deleted project can own surveys too.\n" +
          "Dry run: nothing was erased. Run again with --apply to erase them.\n",
      );
      return 0;
    }
    if (candidates.length > args.max) {
      io.err(
        `Refused: ${candidates.length} users is more than --max ${args.max}. Nothing was erased.\n`,
      );
      return 1;
    }
    const eraseAccount = createEraseAccount(providers);
    let erased = 0;
    for (const id of candidates) {
      try {
        io.out(`${formatErased(await eraseAccount(id, { now: new Date(now()).toISOString() }))}\n`);
      } catch (error) {
        io.err(
          `Error: ${safeErrorText(error)} Erased ${erased} of ${candidates.length} users before the failure.\n`,
        );
        return 1;
      }
      erased += 1;
    }
    io.out(`Erased ${erased} of ${candidates.length} users.\n`);
    return 0;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
