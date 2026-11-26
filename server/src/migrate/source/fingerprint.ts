import type { LegacyConfig } from "../../config.js";
import { connectionStringEntries } from "../../legacy/connection-string.js";

/**
 * Which source a run reads, by names only: the SQL server and database, and the two storage
 * accounts. Never a key, a password or a signature. The names are the same for a read-only and a
 * read-write login to the same stores, so the window's read-only credentials match the copy's.
 * Compared lower-case.
 */
export interface SourceFingerprint {
  sqlServer: string;
  sqlDatabase: string;
  surveysAccount: string;
  resultsAccount: string;
}

const SQL_SERVER_KEYS = ["server", "data source", "address", "addr", "network address"];
const SQL_DATABASE_KEYS = ["database", "initial catalog"];
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
/** The emulator's one account (`UseDevelopmentStorage=true`). */
const EMULATOR_ACCOUNT = "devstoreaccount1";

const first = (entries: [string, string][], keys: readonly string[]): string =>
  entries.find(([key]) => keys.includes(key))?.[1] ?? "";

/** `tcp:host,1433` and `host` name the same server; another port is kept. */
function serverName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^tcp:/, "")
    .replace(/,\s*1433$/, "");
}

/** The account a storage connection string names: its AccountName, else its endpoints' account. */
function accountName(connectionString: string): string {
  const entries = connectionStringEntries(connectionString);
  const named = first(entries, ["accountname"]);
  if (named !== "") return named.toLowerCase();
  for (const key of ["blobendpoint", "tableendpoint", "fileendpoint"]) {
    const endpoint = first(entries, [key]);
    if (endpoint === "") continue;
    try {
      const url = new URL(endpoint);
      // The emulator puts the account in the path; a real endpoint in the host's first label.
      const account = LOCAL_HOSTS.has(url.hostname)
        ? url.pathname.split("/").find((part) => part !== "")
        : url.hostname.split(".")[0];
      if (account) return account.toLowerCase();
    } catch {
      // Not a URL: try the next endpoint.
    }
  }
  if (first(entries, ["usedevelopmentstorage"]).toLowerCase() === "true") return EMULATOR_ACCOUNT;
  return "";
}

export function sourceFingerprint(legacy: LegacyConfig): SourceFingerprint {
  const sql = connectionStringEntries(legacy.sqlConnectionString);
  return {
    sqlServer: serverName(first(sql, SQL_SERVER_KEYS)),
    sqlDatabase: first(sql, SQL_DATABASE_KEYS).trim().toLowerCase(),
    surveysAccount: accountName(legacy.surveysStorageConnectionString),
    resultsAccount: accountName(legacy.resultsStorageConnectionString),
  };
}

export const sameSource = (a: SourceFingerprint, b: SourceFingerprint): boolean =>
  a.sqlServer === b.sqlServer &&
  a.sqlDatabase === b.sqlDatabase &&
  a.surveysAccount === b.surveysAccount &&
  a.resultsAccount === b.resultsAccount;

const shown = (name: string) => (name === "" ? "(none)" : name);

/** `SQL server …, database …; storage accounts … (surveys), … (results)`: names only. */
export const describeSource = (source: SourceFingerprint): string =>
  `SQL server ${shown(source.sqlServer)}, database ${shown(source.sqlDatabase)}; ` +
  `storage accounts ${shown(source.surveysAccount)} (surveys), ` +
  `${shown(source.resultsAccount)} (results)`;
