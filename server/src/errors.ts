import type { components } from "@my-surveys/contract";

export type Problem = components["schemas"]["Problem"];
export type ProblemCode = Problem["code"];
export type ProblemFieldError = NonNullable<Problem["errors"]>[number];

export const PROBLEM_TYPE_BASE = "https://my-surveys.surveyjs.io/problems/";
export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export interface AppErrorInit {
  code: ProblemCode;
  status: number;
  title: string;
  detail?: string;
  errors?: ProblemFieldError[];
  /** The underlying failure, for the server log only; never part of the Problem. */
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ProblemCode;
  readonly status: number;
  readonly title: string;
  readonly detail?: string;
  readonly errors?: ProblemFieldError[];

  constructor(init: AppErrorInit) {
    super(init.detail ?? init.title, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "AppError";
    this.code = init.code;
    this.status = init.status;
    this.title = init.title;
    if (init.detail !== undefined) this.detail = init.detail;
    if (init.errors !== undefined) this.errors = init.errors;
  }
}

export function problem(init: AppErrorInit): Problem {
  return {
    type: `${PROBLEM_TYPE_BASE}${init.code}`,
    title: init.title,
    status: init.status,
    code: init.code,
    ...(init.detail !== undefined && { detail: init.detail }),
    ...(init.errors !== undefined && { errors: init.errors }),
  };
}

interface AjvIssue {
  instancePath?: string;
  message?: string;
  params?: { missingProperty?: string };
}

/** Largest `errors[]` a validation Problem carries (the validator runs with allErrors). */
const MAX_FIELD_ERRORS = 50;

function fieldErrors(issues: readonly AjvIssue[]): ProblemFieldError[] {
  return issues.slice(0, MAX_FIELD_ERRORS).map((issue) => {
    const missing = issue.params?.missingProperty;
    const base = issue.instancePath ?? "";
    const pointer =
      missing === undefined
        ? base
        : `${base}/${missing.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    return { pointer, detail: issue.message ?? "is invalid" };
  });
}

export function toProblem(error: unknown): Problem {
  if (error instanceof AppError) return problem(error);

  if (error instanceof Error) {
    const { code, validation, validationContext } = error as Error & {
      code?: unknown;
      validation?: unknown;
      validationContext?: unknown;
    };
    if (Array.isArray(validation)) {
      const issues = validation as AjvIssue[];
      const errors = fieldErrors(issues);
      const detail =
        issues.length > errors.length
          ? `Showing the first ${errors.length} of ${issues.length} errors.`
          : undefined;
      return validationContext === "body"
        ? problem({
            code: "validation-failed",
            status: 422,
            title: "Validation failed",
            errors,
            ...(detail !== undefined && { detail }),
          })
        : problem({
            code: "bad-request",
            status: 400,
            title: "Bad request",
            errors,
            ...(detail !== undefined && { detail }),
          });
    }
    if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return problem({ code: "payload-too-large", status: 413, title: "Payload too large" });
    }
    if (code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      return problem({
        code: "unsupported-media-type",
        status: 415,
        title: "Unsupported media type",
      });
    }
    if (
      code === "FST_ERR_BAD_URL" ||
      (typeof code === "string" && code.startsWith("FST_ERR_CTP_")) ||
      (error instanceof SyntaxError && (error as { statusCode?: unknown }).statusCode === 400)
    ) {
      return problem({ code: "bad-request", status: 400, title: "Bad request" });
    }
  }
  return problem({ code: "internal-error", status: 500, title: "Internal server error" });
}
