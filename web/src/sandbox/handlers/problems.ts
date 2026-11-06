// Problem answers shaped as the server's (server/src/errors.ts): RFC 9457 bodies with
// `type = https://studio.surveyjs.io/problems/<code>`, `title`, `status`, `code`, and optionally
// `detail` and `errors`. The sandbox code does not import server/src; the conformance subset checks
// that the two agree. Codes are the `Problem.code` enum of contract/openapi.yaml.
import { HttpResponse } from "msw";
import { SandboxOutdatedError, StorageFullError } from "../store";

export const PROBLEM_TYPE_BASE = "https://studio.surveyjs.io/problems/";
export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export interface ProblemFieldError {
  /** JSON Pointer to the invalid field. */
  pointer: string;
  detail: string;
}

export interface ProblemInit {
  code: string;
  status: number;
  title: string;
  detail?: string;
  errors?: ProblemFieldError[];
}

/** Thrown by a handler to answer with a Problem (the server's `AppError`). */
export class ProblemError extends Error {
  readonly init: ProblemInit;
  constructor(init: ProblemInit) {
    super(init.detail ?? init.title);
    this.name = "ProblemError";
    this.init = init;
  }
}

export function problemBody(init: ProblemInit) {
  return {
    type: `${PROBLEM_TYPE_BASE}${init.code}`,
    title: init.title,
    status: init.status,
    code: init.code,
    ...(init.detail !== undefined && { detail: init.detail }),
    ...(init.errors !== undefined && { errors: init.errors }),
  };
}

export function problemResponse(init: ProblemInit): Response {
  return HttpResponse.json(problemBody(init), {
    status: init.status,
    headers: { "Content-Type": PROBLEM_CONTENT_TYPE },
  });
}

export const unauthenticated = () =>
  new ProblemError({ code: "unauthenticated", status: 401, title: "Sign-in required" });

export const notFound = () =>
  new ProblemError({ code: "not-found", status: 404, title: "Not found" });

/** The 404 of every public operation: an unknown and an unpublished survey look the same (results/availability.ts). */
export const surveyNotAvailable = () =>
  new ProblemError({
    code: "survey-not-available",
    status: 404,
    title: "This survey is not available",
  });

export const forbidden = (detail: string) =>
  new ProblemError({ code: "forbidden", status: 403, title: "Forbidden", detail });

export const badRequest = (detail?: string, errors?: ProblemFieldError[]) =>
  new ProblemError({
    code: "bad-request",
    status: 400,
    title: "Bad request",
    ...(detail !== undefined && { detail }),
    ...(errors !== undefined && { errors }),
  });

export const validationFailed = (errors: ProblemFieldError[]) =>
  new ProblemError({ code: "validation-failed", status: 422, title: "Validation failed", errors });

export const notImplemented = (operationId: string) =>
  new ProblemError({
    code: "not-implemented",
    status: 501,
    title: "Not implemented",
    detail: `${operationId} is not available in the demo.`,
  });

/** Dispatched on `window` when a write is refused because the browser storage is full. */
export const STORAGE_FULL_EVENT = "sandbox:storage-full";

/** Dispatched on `window` when another tab reset or replaced the data under this page. */
export const OUTDATED_EVENT = "sandbox:outdated";

/**
 * Runs `answer` and turns what it throws into the server's answers: a `ProblemError` is its
 * Problem, a `StorageFullError` is `413 quota-exceeded` (and fires `sandbox:storage-full` on
 * `window` when there is one), a `SandboxOutdatedError` is `503` (and fires `sandbox:outdated`), anything else is `500 internal-error`.
 */
export async function guarded(answer: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await answer();
  } catch (error) {
    if (error instanceof ProblemError) return problemResponse(error.init);
    if (error instanceof StorageFullError) {
      if (typeof window !== "undefined") window.dispatchEvent(new Event(STORAGE_FULL_EVENT));
      return problemResponse({
        code: "quota-exceeded",
        status: 413,
        title: "Browser storage is full",
      });
    }
    if (error instanceof SandboxOutdatedError) {
      // Another tab reset or replaced the data under this page: the page must reload.
      if (typeof window !== "undefined") window.dispatchEvent(new Event(OUTDATED_EVENT));
      return problemResponse({
        code: "internal-error",
        status: 503,
        title: "The demo was updated in another tab. Reload this page.",
      });
    }
    console.error("sandbox handler failed", error);
    return problemResponse({
      code: "internal-error",
      status: 500,
      title: "Internal server error",
    });
  }
}
