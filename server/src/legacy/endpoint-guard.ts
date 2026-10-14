import { LEGACY_VARIABLES } from "../config.js";
import { connectionStringEntries } from "./connection-string.js";

/** Environment variables the legacy loader and the azure-legacy provider read. */
export { LEGACY_VARIABLES };

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const SQL_SERVER_KEYS = ["server", "data source", "address", "addr", "network address"];

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

/**
 * Drivers pick one of several alias keys (and the last of duplicates) in their own order, so every
 * occurrence of every server key must be local, and at least one must be present.
 */
function isLocalSqlString(value: string): boolean {
  const servers = connectionStringEntries(value)
    .filter(([key]) => SQL_SERVER_KEYS.includes(key))
    .map(([, server]) => server);
  return servers.length > 0 && servers.every((server) => isLocalHost(sqlHost(server)));
}

/** Endpoint keys in the exact case the Azure Storage SDKs look for. */
const STORAGE_ENDPOINT_KEYS = ["BlobEndpoint", "TableEndpoint", "QueueEndpoint", "FileEndpoint"];
const EMULATOR_FLAG = "UseDevelopmentStorage=true";

function isLocalUrl(value: string): boolean {
  try {
    return isLocalHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

/**
 * True when every endpoint the storage SDKs could use is on this machine (Azurite).
 *
 * The SDKs read a connection string their own way: they take the first match, the blob SDK
 * matches keys case-sensitively by prefix, and the table SDK honours the emulator flag anywhere
 * in the string. So this check accepts only strings that every reading resolves the same way:
 * - the emulator flag alone (`UseDevelopmentStorage=true`, optional trailing `;`), or
 * - `BlobEndpoint` and `TableEndpoint` once each, in that exact case, with local URLs, plus
 *   local URLs for any other endpoint key, and no emulator setting.
 */
export function isLocalStorageString(value: string): boolean {
  if (value.trim().replace(/;$/, "").trim() === EMULATOR_FLAG) return true;
  const parts = value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.some((part) => part.toLowerCase().includes("developmentstorage"))) return false;
  const found = new Set<string>();
  for (const part of parts) {
    const key = STORAGE_ENDPOINT_KEYS.find((name) =>
      part.toLowerCase().startsWith(name.toLowerCase()),
    );
    if (key === undefined) continue;
    // Refuse other cases, longer keys, spaces before "=" and duplicates: an SDK may read them.
    if (!part.startsWith(`${key}=`) || found.has(key)) return false;
    found.add(key);
    if (!isLocalUrl(part.slice(key.length + 1))) return false;
  }
  // Both services the loader uses must be pinned locally; otherwise the SDK derives the missing
  // endpoint from AccountName and EndpointSuffix, which would be a real Azure account.
  return found.has("BlobEndpoint") && found.has("TableEndpoint");
}

/**
 * Throws unless a storage client the SDK built points at this machine. The loader obtains its
 * storage clients only through this check, so a string the guard misread still cannot reach Azure.
 * The message names the variable, never the URL.
 */
export function assertLocalClientUrl(url: string, variableName: string): void {
  if (!isLocalUrl(url)) {
    throw new Error(
      `Refusing to use ${variableName}: the storage client it builds does not point at a local ` +
        "endpoint (127.0.0.1, localhost or ::1).",
    );
  }
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
