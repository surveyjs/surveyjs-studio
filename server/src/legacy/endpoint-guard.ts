import { parseConnectionString } from "./connection-string.js";

/** Environment variables the legacy loader (and, later, the azure-legacy provider) reads. */
export const LEGACY_VARIABLES = [
  "LEGACY_SQL_CONNECTION_STRING",
  "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
  "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
] as const;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const SQL_SERVER_KEYS = ["server", "data source", "address", "addr", "network address"];
const STORAGE_ENDPOINT_KEYS = ["blobendpoint", "tableendpoint", "queueendpoint", "fileendpoint"];

function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(
    host
      .trim()
      .replace(/^\[|\]$/g, "")
      .toLowerCase(),
  );
}

/** Host part of a SQL `Server` value such as `tcp:host,1433` or `host\instance`. */
function sqlHost(server: string): string {
  let host = server.replace(/^[a-z]+:/i, "");
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  host = host.split(",")[0] ?? "";
  return host.split("\\")[0] ?? "";
}

function isLocalSqlString(value: string): boolean {
  const pairs = parseConnectionString(value);
  const server = SQL_SERVER_KEYS.map((key) => pairs.get(key)).find((v) => v !== undefined);
  return server !== undefined && isLocalHost(sqlHost(server));
}

function isLocalStorageString(value: string): boolean {
  const pairs = parseConnectionString(value);
  if (pairs.get("usedevelopmentstorage")?.toLowerCase() === "true") return true;
  const endpoints = STORAGE_ENDPOINT_KEYS.map((key) => pairs.get(key)).filter(
    (endpoint): endpoint is string => endpoint !== undefined && endpoint !== "",
  );
  if (endpoints.length === 0) return false; // account name only means a real Azure account
  return endpoints.every((endpoint) => {
    try {
      return isLocalHost(new URL(endpoint).hostname);
    } catch {
      return false;
    }
  });
}

/** Names of the variables that are missing, blank or point at a non-local endpoint. */
export function findNonLocalVariables(env: Readonly<Record<string, string | undefined>>): string[] {
  return LEGACY_VARIABLES.filter((name) => {
    const value = env[name];
    if (value === undefined || value.trim() === "") return true;
    return name === "LEGACY_SQL_CONNECTION_STRING"
      ? !isLocalSqlString(value)
      : !isLocalStorageString(value);
  });
}

/** Throws unless all three connection strings are present and local. The message never holds a value. */
export function assertLocalEndpoints(env: Readonly<Record<string, string | undefined>>): void {
  const offenders = findNonLocalVariables(env);
  if (offenders.length > 0) {
    throw new Error(
      `Refusing to load legacy fixtures: ${offenders.join(", ")} must be set and point at a local ` +
        "endpoint (127.0.0.1, localhost, ::1 or UseDevelopmentStorage=true).",
    );
  }
}
