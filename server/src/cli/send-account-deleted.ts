import { randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { signWebhook } from "../accounts/webhook.js";
import { isWebhookSecret, webhookKey } from "../accounts/webhook-secret.js";
import {
  describeUnexpected,
  GUID,
  parseFlags,
  withEnvFile,
  type CliEnv,
  type CliIo,
} from "./common.js";

export const USAGE = `Usage: pnpm webhook:account-deleted --user <id> [--url <origin>] [--bad-signature] [--env-file <path>]

Sends a signed account.deleted event to a running server, as surveyjs.io does when a user deletes
their account: the server erases that user's data. For demos and local checks. The secret is read
from ACCOUNT_WEBHOOK_SECRET (pass --env-file server/demo.env for the local demo secret).

Options:
  --user <id>         User GUID whose data is erased (required)
  --url <origin>      Server origin (default http://127.0.0.1:3000)
  --bad-signature     Sign with a random key instead, to see the server refuse the call
  --env-file <path>   Load environment variables from this file first;
                      variables already set in the environment win
  --help              Show this text

Exit codes: 0 the server answered 204, 1 any other answer or no answer, 2 usage error or no secret`;

const DEFAULT_URL = "http://127.0.0.1:3000";

export type ParsedArgs =
  | { kind: "run"; user: string; url: string; badSignature: boolean; envFile: string | null }
  | { kind: "help" }
  | { kind: "usage-error"; message: string };

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed = parseFlags(argv, {
    options: ["--user", "--url", "--env-file"],
    switches: ["--bad-signature"],
  });
  if (parsed.kind !== "run") return parsed;
  const user = parsed.values["--user"];
  if (user === undefined) return { kind: "usage-error", message: "--user is required" };
  if (!GUID.test(user)) return { kind: "usage-error", message: "--user must be a user GUID" };
  const url = (parsed.values["--url"] ?? DEFAULT_URL).replace(/\/+$/, "");
  if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
    return { kind: "usage-error", message: "--url must be an http or https origin" };
  }
  return {
    kind: "run",
    user,
    url,
    badSignature: parsed.switches.has("--bad-signature"),
    envFile: parsed.values["--env-file"] ?? null,
  };
}

export interface SendDeps {
  /** Default `process.env` (never changed). */
  readonly env?: CliEnv;
  /** Default the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Default `Date.now`. */
  readonly now?: () => number;
}

/** Runs the command. Returns the exit code; never throws. Never prints the secret. */
export async function run(
  argv: readonly string[],
  io: CliIo,
  deps: SendDeps = {},
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
  const secret = env.ACCOUNT_WEBHOOK_SECRET?.trim();
  if (!secret) {
    io.err(
      "ACCOUNT_WEBHOOK_SECRET is not set. Pass --env-file server/demo.env for the local demo secret.\n",
    );
    return 2;
  }
  if (!isWebhookSecret(secret)) {
    io.err("ACCOUNT_WEBHOOK_SECRET must be whsec_ followed by the base64 of at least 24 bytes.\n");
    return 2;
  }

  const body = JSON.stringify({ type: "account.deleted", data: { userId: args.user } });
  const key = args.badSignature ? randomBytes(32) : webhookKey(secret);
  const now = deps.now ?? Date.now;
  const headers = signWebhook(key, `msg_${randomUUID()}`, Math.floor(now() / 1000), body);
  try {
    const response = await (deps.fetch ?? globalThis.fetch)(
      `${args.url}/api/v1/webhooks/account-deleted`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
        signal: AbortSignal.timeout(30_000),
      },
    );
    const text = await response.text();
    io.out(`HTTP ${response.status}\n${text === "" ? "" : `${text}\n`}`);
    return response.status === 204 ? 0 : 1;
  } catch (error) {
    // fetch reports a refused connection as a TypeError whose cause holds the code.
    const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
    io.err(`Error: no answer from ${args.url}: ${describeUnexpected(cause)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
