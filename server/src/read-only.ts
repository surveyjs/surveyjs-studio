import type { onRequestAsyncHookHandler } from "fastify";
import type { OperationId } from "./api.js";
import { AppError } from "./errors.js";

/**
 * `READ_ONLY=true` (design D5): one guard, fail closed. Every operation that is not `GET` is
 * refused unless it is on this list, so a write operation added later is refused by default.
 */
export const READ_ONLY_ALLOWED: readonly OperationId[] = ["logout", "passwordLogin"];

/** True for every non-`GET` operation not in {@link READ_ONLY_ALLOWED}. */
export function refusedWhenReadOnly(op: { method: string; operationId: string }): boolean {
  return (
    op.method.toUpperCase() !== "GET" &&
    !(READ_ONLY_ALLOWED as readonly string[]).includes(op.operationId)
  );
}

export const READ_ONLY_TITLE = "My Surveys is read-only at the moment. Changes cannot be saved.";

/** The `503 read-only` refusal of a write while `READ_ONLY=true`. */
export const readOnlyError = (): AppError =>
  new AppError({ code: "read-only", status: 503, title: READ_ONLY_TITLE });

/** The `onRequest` hook of a refused operation: answers `503 read-only` before anything else runs. */
export const refuseReadOnly: onRequestAsyncHookHandler = async () => {
  throw readOnlyError();
};
