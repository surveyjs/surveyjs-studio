import { pathToFileURL } from "node:url";
import { createLegacyClient, DEFAULT_LEGACY_API } from "../smoke/legacy-client.js";
import { formatTable, runSmoke, smokePassed } from "../smoke/steps.js";
import {
  parseFlags,
  withEnvFile,
  withProviders,
  type CliEnv,
  type CliIo,
  type StoreCommandDeps,
} from "./common.js";

export const USAGE = `Usage: pnpm smoke:legacy --account <email> --yes [--env-file <path>] [--legacy-api <base URL>]

Proves that the old api.surveyjs.io reads what the app writes. Acting as the test account,
the run creates a test survey named "Smoke test <time>" in the account's Personal space and a
test project, writes through the app's services (rename, definition, history, theme, a response,
Grant Access, publish, unpublish, move in and out of the project) and reads each write back
through api.surveyjs.io. It deletes the survey and the project at the end, also after a failure.
Only the test survey and the test project are written. Prints a table step | app | legacy | result;
the old site's pages are checked by hand (docs/operations/smoke-test.md).

Needs STORAGE_PROVIDER=azure-legacy with the LEGACY_* settings of the store to test, and
SMOKE_ACCESS_KEY: the test account's access key for api.surveyjs.io (never printed).

Options:
  --account <email>       The test account's email (required); it must exist and not be blocked
  --yes                   Run; without it nothing is done
  --env-file <path>       Load environment variables from this file first;
                          variables already set in the environment win
  --legacy-api <base URL> The legacy API (default ${DEFAULT_LEGACY_API})
  --help                  Show this text

Exit codes: 0 every check passed, 1 a check failed or an error, 2 usage error or refused (no
--yes, no SMOKE_ACCESS_KEY, no persistent store, READ_ONLY=true, an unknown or blocked account)`;

export type ParsedArgs =
  | {
      kind: "run";
      account: string;
      yes: boolean;
      envFile: string | null;
      legacyApi: string;
    }
  | { kind: "help" }
  | { kind: "usage-error"; message: string };

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed = parseFlags(argv, {
    options: ["--account", "--env-file", "--legacy-api"],
    switches: ["--yes"],
  });
  if (parsed.kind !== "run") return parsed;
  const account = parsed.values["--account"];
  if (account === undefined) return { kind: "usage-error", message: "--account is required" };
  const legacyApi = parsed.values["--legacy-api"] ?? DEFAULT_LEGACY_API;
  const protocol = URL.canParse(legacyApi) ? new URL(legacyApi).protocol : "";
  if (protocol !== "https:" && protocol !== "http:") {
    return { kind: "usage-error", message: "--legacy-api must be an http or https URL" };
  }
  return {
    kind: "run",
    account,
    yes: parsed.switches.has("--yes"),
    envFile: parsed.values["--env-file"] ?? null,
    legacyApi,
  };
}

export interface SmokeCommandDeps extends StoreCommandDeps {
  /** Default the global `fetch` (for the legacy API). */
  readonly fetch?: typeof fetch;
}

/**
 * `io` with every occurrence of `secret` replaced: a second guard, the run never prints it. Real
 * keys are 32 hex digits; a key under 8 characters is not replaced, as it would mangle the text.
 */
function redacting(io: CliIo, secret: string): CliIo {
  const clean = (text: string): string =>
    secret.length < 8 ? text : text.split(secret).join("[access key]");
  return { out: (text) => io.out(clean(text)), err: (text) => io.err(clean(text)) };
}

/** Runs the smoke test. Returns the exit code; never throws and never prints the access key. */
export async function run(
  argv: readonly string[],
  io: CliIo,
  deps: SmokeCommandDeps = {},
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
  if (!args.yes) {
    io.err(
      "Refused: pass --yes to run. The smoke test writes a test survey and a test project to the " +
        "store and deletes them at the end.\n",
    );
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
  const accessKey = env.SMOKE_ACCESS_KEY?.trim() ?? "";
  if (accessKey === "") {
    io.err(
      "Refused: SMOKE_ACCESS_KEY is not set. Set it to the test account's access key for " +
        "api.surveyjs.io.\n",
    );
    return 2;
  }
  const safeIo = redacting(io, accessKey);
  return withProviders(
    null,
    safeIo,
    { ...deps, env },
    {
      writes: true,
      readOnlyRefusal: "Refused: READ_ONLY=true. The smoke test writes; nothing was written.",
    },
    async (providers) => {
      const found = await providers.users.findUserByEmail(args.account);
      if (found === null) {
        safeIo.err(`Refused: no account with this email: ${args.account}\n`);
        return 2;
      }
      if (found.blocked) {
        safeIo.err(`Refused: the account ${args.account} is blocked.\n`);
        return 2;
      }
      safeIo.out(`Account ${found.id} (${found.email})\nLegacy API: ${args.legacyApi}\n\n`);
      const result = await runSmoke({
        providers,
        user: {
          id: found.id,
          email: found.email,
          displayName: found.displayName,
          avatarUrl: null,
        },
        legacy: createLegacyClient({
          baseUrl: args.legacyApi,
          accessKey,
          ...(deps.fetch && { fetch: deps.fetch }),
        }),
        ...(deps.now && { now: deps.now }),
      });
      safeIo.out(formatTable(result.steps));
      for (const line of result.cleanup) {
        (line.failed ? safeIo.err : safeIo.out)(`Cleanup: ${line.text}\n`);
      }
      for (const warning of result.warnings) safeIo.err(`warning: ${warning}\n`);
      const passed = smokePassed(result);
      const manual = result.steps.filter((s) => s.result === "manual").length;
      safeIo.out(
        passed
          ? `\nResult: PASSED. ${manual} step(s) are manual: see docs/operations/smoke-test.md.\n`
          : "\nResult: FAILED.\n",
      );
      return passed ? 0 : 1;
    },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
