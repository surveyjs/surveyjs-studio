import createClient from "openapi-fetch";
import createQueryClient from "openapi-react-query";
import type { components, paths } from "@my-surveys/contract/types";

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

export const client = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? "/api/v1",
  credentials: "include",
});

export const $api = createQueryClient(client);
