/** Variables that must hold a value before the server may start against the real stores. */
export const REQUIRED_VARIABLES = [
  "LEGACY_SQL_CONNECTION_STRING",
  "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
  "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
  "OIDC_ISSUER_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
] as const;

/** Problems that stop the launcher, by variable name; never a value. */
export function envProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  if (env["STORAGE_PROVIDER"] !== "azure-legacy") {
    problems.push("STORAGE_PROVIDER: must be azure-legacy");
  }
  for (const name of REQUIRED_VARIABLES) {
    if ((env[name] ?? "").trim() === "") problems.push(`${name}: empty`);
  }
  return problems;
}

/** `Key=Value;` pairs of a connection string, keys lower-cased. */
function connectionPairs(value: string): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const part of value.split(";")) {
    const at = part.indexOf("=");
    if (at > 0) pairs.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim());
  }
  return pairs;
}

/** `server/database` of an mssql connection string, without user or password. */
export function describeSql(value: string): string {
  const pairs = connectionPairs(value);
  const server = (pairs.get("server") ?? pairs.get("data source") ?? pairs.get("address") ?? "?")
    .replace(/^tcp:/i, "")
    .replace(/,1433$/, "");
  const database = pairs.get("database") ?? pairs.get("initial catalog") ?? "?";
  return `${server}/${database}`;
}

/** The account name of an Azure Storage connection string, without its key. */
export function describeStorage(value: string): string {
  const pairs = connectionPairs(value);
  const account = pairs.get("accountname");
  if (account) return account;
  for (const key of ["blobendpoint", "tableendpoint"]) {
    const endpoint = pairs.get(key);
    if (endpoint && URL.canParse(endpoint)) return new URL(endpoint).host;
  }
  return "?";
}

/** The banner lines naming what the server is about to write to. */
export function describeTargets(env: Record<string, string | undefined>): string[] {
  return [
    `SQL database:     ${describeSql(env["LEGACY_SQL_CONNECTION_STRING"] ?? "")}`,
    `Surveys storage:  ${describeStorage(env["LEGACY_SURVEYS_STORAGE_CONNECTION_STRING"] ?? "")}`,
    `Results storage:  ${describeStorage(env["LEGACY_RESULTS_STORAGE_CONNECTION_STRING"] ?? "")}`,
    `Sign-in issuer:   ${env["OIDC_ISSUER_URL"] ?? "?"}`,
    `Browser origin:   ${env["PUBLIC_BASE_URL"] ?? "http://localhost:3000"}`,
  ];
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * True for an https issuer on this machine: its development certificate is self-signed, so the
 * launcher reads it from the running server and hands it to Node. Never for a remote issuer.
 */
export function isLocalHttpsIssuer(issuer: string): boolean {
  if (!URL.canParse(issuer)) return false;
  const url = new URL(issuer);
  return url.protocol === "https:" && LOOPBACK_HOSTS.has(url.hostname);
}
