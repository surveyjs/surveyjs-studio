import { pathToFileURL } from "node:url";
import { startUserApiStub, stubDataFromFixtures } from "./stub.js";

export const USAGE = `Usage: pnpm user-api:stub [--port <n>] [--host <loopback host>] [--token <value>] [--fixtures <dir>]

Runs a local stand-in for the surveyjs.io user API with the users and licences of the legacy
fixtures. Point a server at it with USER_DIRECTORY=surveyjs-api, USER_API_URL=http://127.0.0.1:<port>
and USER_API_TOKEN=<the token>. For tests and demos only.

Options:
  --port <n>               Port to listen on (default 4010; 0 picks a free one)
  --host <host>            127.0.0.1 (default), localhost or ::1
  --token <value>          Bearer token the stub accepts (default local-stub-token)
  --fixtures <dir>         Legacy fixtures folder (default server/fixtures/legacy)
  --help                   Show this text

Exit code 2 for a usage error.`;

export type ParsedArgs =
  | { kind: "run"; port: number; host: string; token: string; fixtures: string | undefined }
  | { kind: "help" }
  | { kind: "usage-error"; message: string };

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let port = 4010;
  let host = "127.0.0.1";
  let token = "local-stub-token";
  let fixtures: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help") return { kind: "help" };
    if (arg === "--") continue;
    if (arg === "--port" || arg === "--host" || arg === "--token" || arg === "--fixtures") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return { kind: "usage-error", message: `${arg} needs a value` };
      }
      i++;
      if (arg === "--port") {
        if (!/^\d+$/.test(value) || Number(value) > 65535) {
          return { kind: "usage-error", message: "--port must be a number from 0 to 65535" };
        }
        port = Number(value);
      } else if (arg === "--host") host = value;
      else if (arg === "--token") token = value;
      else fixtures = value;
    } else {
      return { kind: "usage-error", message: `Unknown argument: ${arg}` };
    }
  }
  if (token.trim() === "") return { kind: "usage-error", message: "--token must not be blank" };
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    return { kind: "usage-error", message: "--host must be 127.0.0.1, localhost or ::1" };
  }
  return { kind: "run", port, host, token, fixtures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.kind === "help") {
    process.stdout.write(`${USAGE}\n`);
  } else if (args.kind === "usage-error") {
    process.stderr.write(`${args.message}\n\n${USAGE}\n`);
    process.exitCode = 2;
  } else {
    const stub = await startUserApiStub({
      data: await stubDataFromFixtures(args.fixtures),
      token: args.token,
      host: args.host,
      port: args.port,
    });
    process.stdout.write(`User API stub listening on ${stub.url}\n`);
    const stop = () => {
      void stub.close().finally(() => process.exit(0));
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  }
}
