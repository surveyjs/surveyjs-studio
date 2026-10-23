import { connectionPairs, envProblems } from "../dev-prod-data/target.js";

/** The app's port inside the container, published as 127.0.0.1:3000. */
export const APP_PORT = 3000;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const SQL_SERVER_KEYS = ["server", "data source", "address", "addr", "network address"];
const STORAGE_VARIABLES = [
  "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
  "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
] as const;
/** Azurite's Blob and Table ports, for `UseDevelopmentStorage=true`. */
const EMULATOR_PORTS = [10000, 10002];

function isLoopbackUrl(value: string): boolean {
  return URL.canParse(value) && LOOPBACK_HOSTS.has(new URL(value).hostname);
}

function urlPort(url: URL): number {
  if (url.port !== "") return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

interface Endpoint {
  readonly variable: string;
  readonly port: number;
}

/** The SQL endpoint when its server is on loopback; `instance` when it names a named instance. */
function sqlEndpoint(value: string): { port: number } | "instance" | undefined {
  const pairs = connectionPairs(value);
  const key = SQL_SERVER_KEYS.find((name) => pairs.has(name));
  if (key === undefined) return undefined;
  const server = (pairs.get(key) ?? "").replace(/^tcp:/i, "");
  const [hostAndInstance = "", port] = server.split(",");
  const [host = "", instance] = hostAndInstance.split("\\");
  if (!LOOPBACK_HOSTS.has(host.trim().toLowerCase())) return undefined;
  if (instance !== undefined && port === undefined) return "instance";
  return { port: port === undefined ? 1433 : Number(port.trim()) };
}

/** Every endpoint of the env on this machine: the issuer, SQL Server and the storage endpoints. */
function loopbackEndpoints(env: Record<string, string | undefined>): Endpoint[] {
  const endpoints: Endpoint[] = [];
  const issuer = env["OIDC_ISSUER_URL"] ?? "";
  if (isLoopbackUrl(issuer)) {
    endpoints.push({ variable: "OIDC_ISSUER_URL", port: urlPort(new URL(issuer)) });
  }
  const sql = sqlEndpoint(env["LEGACY_SQL_CONNECTION_STRING"] ?? "");
  if (typeof sql === "object") endpoints.push({ variable: "LEGACY_SQL_CONNECTION_STRING", ...sql });
  for (const variable of STORAGE_VARIABLES) {
    const value = env[variable] ?? "";
    const pairs = connectionPairs(value);
    if (pairs.get("usedevelopmentstorage")?.toLowerCase() === "true") {
      for (const port of EMULATOR_PORTS) endpoints.push({ variable, port });
    }
    for (const key of ["blobendpoint", "tableendpoint"]) {
      const endpoint = pairs.get(key) ?? "";
      if (isLoopbackUrl(endpoint)) endpoints.push({ variable, port: urlPort(new URL(endpoint)) });
    }
  }
  return endpoints;
}

/**
 * The ports the forwarder maps from the app's localhost to the host, in ascending order: the
 * issuer's (the site's sign-in service on this machine) and any other endpoint of the env file on this machine.
 */
export function forwardedPorts(env: Record<string, string | undefined>): number[] {
  return [...new Set(loopbackEndpoints(env).map((endpoint) => endpoint.port))].sort(
    (a, b) => a - b,
  );
}

/**
 * Lines of the env file whose value docker compose would expand: compose reads `$NAME` and
 * `${NAME}` in unquoted and double-quoted values (Node's parser, which `pnpm dev:prod-data` uses,
 * does not). Only the variable name is reported.
 */
function expandedVariables(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;
    const [, name = "", value = ""] = match;
    if (!value.startsWith("'") && value.includes("$")) names.push(name);
  }
  return names;
}

/**
 * Problems that stop `pnpm image:prod-data`, by variable name; never a value. `text` is the env
 * file as written, `env` the same file parsed.
 */
export function imageEnvProblems(env: Record<string, string | undefined>, text: string): string[] {
  const problems = envProblems(env);
  const secret = env["SESSION_SECRET"] ?? "";
  if (secret.length < 32) {
    problems.push(
      "SESSION_SECRET: at least 32 characters (the image runs with NODE_ENV=production)",
    );
  }
  const identity = env["IDENTITY_PROVIDER"];
  if (identity !== undefined && identity !== "" && identity !== "surveyjs-oidc") {
    problems.push("IDENTITY_PROVIDER: must be surveyjs-oidc");
  }
  const issuer = env["OIDC_ISSUER_URL"] ?? "";
  if (issuer.trim() !== "" && !isLoopbackUrl(issuer)) {
    problems.push(
      "OIDC_ISSUER_URL: must be on localhost, 127.0.0.1 or [::1] (the launcher forwards it to this machine)",
    );
  }
  if (sqlEndpoint(env["LEGACY_SQL_CONNECTION_STRING"] ?? "") === "instance") {
    problems.push("LEGACY_SQL_CONNECTION_STRING: a named instance on this machine needs its port");
  }
  for (const endpoint of loopbackEndpoints(env)) {
    if (endpoint.port === APP_PORT) {
      problems.push(`${endpoint.variable}: port ${APP_PORT} is the app's own port`);
    }
  }
  for (const name of expandedVariables(text)) {
    problems.push(
      `${name}: contains $, which docker compose expands; put the value in single quotes`,
    );
  }
  return problems;
}

/**
 * The forwarder's shell script: for each port, socat listens on 127.0.0.1 and [::1] (Node tries
 * `localhost` as ::1 first) and connects to the same port on the host.
 */
export function forwardScript(ports: readonly number[]): string {
  const listeners = ports.flatMap((port) => [
    `socat TCP4-LISTEN:${port},bind=127.0.0.1,fork,reuseaddr TCP:host.docker.internal:${port} &`,
    `socat TCP6-LISTEN:${port},bind=[::1],fork,reuseaddr TCP:host.docker.internal:${port} &`,
  ]);
  return ["trap 'exit 0' TERM INT", ...listeners, "wait"].join("\n");
}
