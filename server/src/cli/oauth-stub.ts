import { pathToFileURL } from "node:url";
import { startOAuthStub } from "../testing/oauth-stub.js";

export const USAGE = `Usage: pnpm oauth-stub [--port <n>]

Runs a local stand-in for Google, GitHub, Facebook and surveyjs.io sign-in. Point a server at it
with OAUTH_STUB_URL=<printed url> (and OIDC_ISSUER_URL=<url>/surveyjs for surveyjs.io). The client
secret of each provider is stub-secret-<provider>. For tests and demos only.

Options:
  --port <n>   Port to listen on (default 5180; 0 picks a free one)
  --help       Show this text

Exit code 2 for a usage error.`;

export type ParsedArgs =
  { kind: "run"; port: number } | { kind: "help" } | { kind: "usage-error"; message: string };

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let port = 5180;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help") return { kind: "help" };
    if (arg === "--") continue;
    if (arg === "--port") {
      const value = argv[++i];
      if (value === undefined || !/^\d+$/.test(value) || Number(value) > 65535) {
        return { kind: "usage-error", message: "--port must be a number from 0 to 65535" };
      }
      port = Number(value);
    } else {
      return { kind: "usage-error", message: `Unknown argument: ${arg}` };
    }
  }
  return { kind: "run", port };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.kind === "help") {
    process.stdout.write(`${USAGE}\n`);
  } else if (args.kind === "usage-error") {
    process.stderr.write(`${args.message}\n\n${USAGE}\n`);
    process.exitCode = 2;
  } else {
    const stub = await startOAuthStub({ port: args.port });
    process.stdout.write(`OAuth stub on ${stub.url}\n`);
    const stop = () => {
      void stub.close().finally(() => process.exit(0));
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  }
}
