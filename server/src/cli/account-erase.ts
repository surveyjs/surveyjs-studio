import { pathToFileURL } from "node:url";
import {
  createEraseAccount,
  previewErasure,
  type ErasurePreview,
  type ErasureSummary,
} from "../accounts/erasure.js";
import type { User } from "../domain/types.js";
import type { MemberErasure } from "../providers/types.js";
import { GUID, parseFlags, withProviders, type CliIo, type StoreCommandDeps } from "./common.js";

export const USAGE = `Usage: pnpm account:erase --user <id|email> [--yes] [--env-file <path>]

Erases the data of one account: its personal surveys with their results and files, and its place
in every project (a project left without an admin passes to its next member; a project without
another member is deleted with its surveys). Without --yes it only prints what would be erased.
The user directory is not asked whether the account is gone. STORAGE_PROVIDER must name a
persistent store (for the local replica pass --env-file docker/azurite.env).

Options:
  --user <id|email>   User GUID or email address (required); an email is looked up in the
                      user directory, a GUID is erased even when the directory does not know it
  --yes               Erase; without it nothing is written
  --env-file <path>   Load environment variables from this file first;
                      variables already set in the environment win
  --help              Show this text

With READ_ONLY=true, --yes is refused (exit 2); the dry run still works.

Exit codes: 0 success, 1 user not found or store error, 2 usage error, no persistent store or
READ_ONLY=true with --yes`;

export type ParsedArgs =
  | { kind: "run"; user: string; yes: boolean; envFile: string | null }
  | { kind: "help" }
  | { kind: "usage-error"; message: string };

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed = parseFlags(argv, { options: ["--user", "--env-file"], switches: ["--yes"] });
  if (parsed.kind !== "run") return parsed;
  const user = parsed.values["--user"];
  if (user === undefined) return { kind: "usage-error", message: "--user is required" };
  return {
    kind: "run",
    user,
    yes: parsed.switches.has("--yes"),
    envFile: parsed.values["--env-file"] ?? null,
  };
}

function effect(decision: MemberErasure, surveyCount: number): string {
  switch (decision.kind) {
    case "remove":
      return "leaves the project";
    case "promote":
      return `leaves the project; ${decision.successorId} becomes an admin`;
    case "last-member":
      return `the project is deleted with its ${surveyCount} surveys`;
    case "not-member":
      return "nothing to do";
  }
}

/** The plan of the erasure: the account, its personal surveys and what happens to each project. */
export function formatPlan(user: User | null, preview: ErasurePreview): string {
  const account =
    user === null
      ? `Account ${preview.userId} (not in the user directory)`
      : `Account ${preview.userId} (${user.email}, ${user.displayName})`;
  return [
    account,
    `Personal surveys to delete: ${preview.personalSurveys.length}`,
    ...preview.personalSurveys.map((survey) => `  ${survey.id}  ${survey.name}`),
    `Projects: ${preview.projects.length}`,
    ...preview.projects.map(
      (project) =>
        `  ${project.id}  ${project.name || "(membership not readable)"}: ` +
        effect(project.decision, project.surveyCount),
    ),
  ]
    .map((line) => `${line}\n`)
    .join("");
}

/** `Erased <id>: <s> surveys deleted, <l> projects left, <d> projects deleted, <p> admins promoted.` */
export function formatErased(summary: ErasureSummary): string {
  return (
    `Erased ${summary.userId}: ${summary.surveysDeleted} surveys deleted, ` +
    `${summary.projectsLeft} projects left, ${summary.projectsDeleted} projects deleted, ` +
    `${summary.adminsPromoted} admins promoted.`
  );
}

/** Runs the command. Returns the exit code; never throws. Writes only with `--yes`. */
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
  return withProviders(args.envFile, io, deps, { writes: args.yes }, async (providers) => {
    let user: User | null;
    if (GUID.test(args.user)) {
      user = await providers.users.getUser(args.user);
    } else {
      user = await providers.users.findUserByEmail(args.user);
      if (user === null) {
        io.err(`User not found in the user directory: ${args.user}\n`);
        return 1;
      }
    }
    const userId = user?.id ?? args.user.toLowerCase();
    const stores = {
      surveys: providers.surveys,
      projects: providers.projects,
      files: providers.files,
    };
    io.out(formatPlan(user, await previewErasure(stores, userId)));
    if (!args.yes) {
      io.out(
        "The final decision for each project is made at erase time and can differ from this plan.\n" +
          "Dry run: nothing was erased. Run again with --yes to erase.\n",
      );
      return 0;
    }
    const summary = await createEraseAccount(stores)(userId, {
      now: new Date(now()).toISOString(),
    });
    io.out(`${formatErased(summary)}\n`);
    return 0;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
