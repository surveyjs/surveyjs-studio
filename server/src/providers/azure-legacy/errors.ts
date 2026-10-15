/**
 * Errors of the legacy stores. A driver message may name the host or quote a connection string,
 * so only operation names and driver codes reach an error message.
 */

/** Error from a legacy store operation. The message names the operation and the driver's error code only. */
export class LegacyStoreError extends Error {
  constructor(operation: string, error: unknown) {
    super(`Legacy store ${operation} failed${describeDriverError(error)}`);
    this.name = "LegacyStoreError";
  }
}

/**
 * Codes such as ESOCKET, ELOGIN or BlobAlreadyExists, SQL error numbers and HTTP statuses are
 * safe; driver messages may name the host.
 */
function describeDriverError(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const { code, number, statusCode } = error as {
    code?: unknown;
    number?: unknown;
    statusCode?: unknown;
  };
  const parts: string[] = [];
  if (typeof code === "string" && /^[A-Z][A-Za-z]{1,63}$/.test(code)) parts.push(code);
  if (typeof number === "number") parts.push(`SQL error ${number}`);
  if (typeof statusCode === "number") parts.push(`HTTP ${statusCode}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/** The HTTP status of an Azure Storage error, if any. */
export const statusOf = (error: unknown): unknown =>
  typeof error === "object" && error !== null
    ? (error as { statusCode?: unknown }).statusCode
    : undefined;
