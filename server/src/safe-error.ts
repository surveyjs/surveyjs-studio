/**
 * The parts of a driver or SDK error that are safe to log or show. Codes such as ESOCKET, ELOGIN
 * or AuthorizationFailure, SQL error numbers and HTTP statuses are safe; a driver message may name
 * the host or quote a connection string, so it is never read here.
 */
export function safeErrorParts(error: unknown): string[] {
  if (typeof error !== "object" || error === null) return [];
  const { code, number, statusCode } = error as {
    code?: unknown;
    number?: unknown;
    statusCode?: unknown;
  };
  const parts: string[] = [];
  if (typeof code === "string" && /^[A-Z][A-Za-z]{1,63}$/.test(code)) parts.push(code);
  if (typeof number === "number") parts.push(`SQL error ${number}`);
  if (typeof statusCode === "number") parts.push(`HTTP ${statusCode}`);
  return parts;
}

/**
 * A failed readiness check's safe category: `timeout` (a timeout, or an abort by the check's
 * timeout signal), the error's safe parts, or `error`.
 */
export function safeErrorCategory(error: unknown): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "timeout";
  }
  const parts = safeErrorParts(error);
  return parts.length > 0 ? parts.join(", ") : "error";
}
