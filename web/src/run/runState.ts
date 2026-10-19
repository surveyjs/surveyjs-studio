import { ApiError } from "../api/client";
import type { RunSurveyData } from "./load";

/** What the run page shows (S17). */
export type RunPageState =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "failed" }
  | { readonly kind: "running"; readonly data: RunSurveyData }
  | { readonly kind: "completed"; readonly data: RunSurveyData };

/** The parts of the survey query the state depends on. */
export interface RunQuery {
  readonly status: "pending" | "error" | "success";
  readonly error?: unknown;
  readonly data?: RunSurveyData;
}

/**
 * The page state for the survey query. A `404` (unknown or unpublished survey) and a `400` (an
 * id the server refuses) are "not available"; any other failure can be retried. A survey whose
 * limit is on and that this browser has completed shows the library's completed-before content.
 */
export function runPageState(query: RunQuery): RunPageState {
  if (query.status === "pending") return { kind: "loading" };
  if (query.status === "error" || query.data === undefined) {
    const { error } = query;
    const status = error instanceof ApiError ? error.problem.status : undefined;
    return status === 404 || status === 400 ? { kind: "unavailable" } : { kind: "failed" };
  }
  const { data } = query;
  return data.limitCookie !== null && data.completed
    ? { kind: "completed", data }
    : { kind: "running", data };
}
