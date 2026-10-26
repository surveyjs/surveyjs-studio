import createClient from "openapi-fetch";
import createQueryClient from "openapi-react-query";
import type { components, paths } from "@surveyjs-studio/contract/types";
import { csrfMiddleware } from "./csrf";

export type Problem = components["schemas"]["Problem"];

/** Thrown when the API answers with an RFC 9457 Problem (or any non-2xx response). */
export class ApiError extends Error {
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.title);
    this.name = "ApiError";
    this.problem = problem;
  }
}

function isProblem(body: unknown): body is Problem {
  return (
    typeof body === "object" &&
    body !== null &&
    "title" in body &&
    typeof body.title === "string" &&
    "code" in body
  );
}

/** Builds an ApiError from a failed response, using the Problem body when the server sent one. */
export function toApiError(body: unknown, response: Response): ApiError {
  if (isProblem(body)) return new ApiError(body);
  return new ApiError({
    type: "about:blank",
    title: response.statusText || `HTTP ${response.status}`,
    status: response.status,
    code: "internal-error",
  });
}

/** Where the API lives; the download links use it too. */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export const client = createClient<paths>({
  baseUrl: API_BASE_URL,
  credentials: "include",
});

client.use(csrfMiddleware);

/**
 * Query retry policy: a client error (401, 404, …) is an answer, not a glitch, so it fails fast —
 * the page reacts at once, for example by redirecting from an unknown project. Server and network
 * errors, 408 and 429 retry up to 3 times.
 */
export function shouldRetryQuery(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError) {
    const { status } = error.problem;
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
  }
  return failureCount < 3;
}

export const $api = createQueryClient(client);
