import { ApiError } from "../api/client";
import type { PublicResults } from "../api/public";

/** What the public results page shows. */
export type PublicResultsState =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly data: PublicResults };

/** The parts of the results query the state depends on. */
export interface PublicResultsQuery {
  readonly status: "pending" | "error" | "success";
  readonly error?: unknown;
  readonly data?: PublicResults;
}

/** A 404 (results not public, unknown survey) and a 400 are "not available"; other failures retry. */
export function publicResultsState({
  status,
  error,
  data,
}: PublicResultsQuery): PublicResultsState {
  if (status === "pending") return { kind: "loading" };
  if (status === "error" || data === undefined) {
    const code = error instanceof ApiError ? error.problem.status : undefined;
    return code === 404 || code === 400 ? { kind: "unavailable" } : { kind: "failed" };
  }
  return { kind: "ready", data };
}
