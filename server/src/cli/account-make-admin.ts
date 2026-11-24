import { pathToFileURL } from "node:url";
import { isDeletedAccountEmail } from "../admin/rules.js";
import { ConfigError, type AppConfig } from "../config.js";
import { parseFlags, withProviders, type CliIo, type StoreCommandDeps } from "./common.js";

export const USAGE = `Usage: pnpm account:make-admin --email <address> [--env-file <path>]

Makes an existing local account an active instance admin (USER_DIRECTORY=local). Use it when the
instance has no active admin: on the hosted service, when the last instance admin deleted their
surveyjs.io account and was kept as a deleted placeholder, ADMIN_EMAIL is not made admin again
(ADR 0043). The person signs in first, so that their account exists. Prints the user id only.
STORAGE_PROVIDER must name a persistent store.

Options:
  --email <address>   Email of the account (required)
  --env-file <path>   Load environment variables from this file first;
                      variables already set in the environment win
  --help              Show this text

With READ_ONLY=true it is refused (exit 2).

Exit codes: 0 success, 1 no such account, a deleted account's placeholder, or a store error,
2 usage error, no persistent store or READ_ONLY=true`;

/** Printed with READ_ONLY=true: this command changes an account, it erases nothing. */
export const READ_ONLY_MAKE_ADMIN = "Refused: READ_ONLY=true. Nothing was changed.";

export type ParsedArgs =
  | { kind: "run"; email: string; envFile: string | null }
  | { kind: "help" }
  | { kind: "usage-error"; message: string };

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed = parseFlags(argv, { options: ["--email", "--env-file"], switches: [] });
  if (parsed.kind !== "run") return parsed;
  const email = parsed.values["--email"]?.trim();
  if (!email) return { kind: "usage-error", message: "--email is required" };
  return { kind: "run", email, envFile: parsed.values["--env-file"] ?? null };
}

/** The command needs the local accounts: no other user directory has instance admins. */
function assertLocalAccounts(config: Pick<AppConfig, "userDirectory">): void {
  if (config.userDirectory !== "local") {
    throw new ConfigError("account:make-admin needs USER_DIRECTORY=local");
  }
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
  return withProviders(
    args.envFile,
    io,
    deps,
    { writes: true, readOnlyRefusal: READ_ONLY_MAKE_ADMIN, guard: assertLocalAccounts },
    async (providers) => {
      const { accounts } = providers;
      if (accounts === null) throw new ConfigError("account:make-admin needs USER_DIRECTORY=local");
      // The address is not printed back: the output carries the user id only.
      if (isDeletedAccountEmail(args.email)) {
        io.err("Refused: a deleted account's placeholder cannot be made admin.\n");
        return 1;
      }
      const account = await accounts.accountByEmail(args.email);
      if (account === null) {
        io.err("No account has this email. The person signs in first.\n");
        return 1;
      }
      const update = await accounts.updateAccount(account.user.id, {
        instanceRole: "admin",
        status: "active",
      });
      if (update.outcome !== "updated") {
        io.err("No account has this email. The person signs in first.\n");
        return 1;
      }
      const { id } = update.account.user;
      io.out(
        update.account.status === "active"
          ? `${id} is now an active instance admin.\n`
          : `${id} is now an instance admin, ${update.account.status}: it has no way to sign in yet.\n`,
      );
      return 0;
    },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
