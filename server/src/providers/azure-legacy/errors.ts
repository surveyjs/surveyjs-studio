import { safeErrorParts } from "../../safe-error.js";

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

function describeDriverError(error: unknown): string {
  const parts = safeErrorParts(error);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/** The HTTP status of an Azure Storage error, if any. */
export const statusOf = (error: unknown): unknown =>
  typeof error === "object" && error !== null
    ? (error as { statusCode?: unknown }).statusCode
    : undefined;
