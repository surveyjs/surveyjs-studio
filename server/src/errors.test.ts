import { describe, expect, it } from "vitest";
import { AppError, toProblem } from "./errors.js";

const base = "https://my-surveys.surveyjs.io/problems/";

function fastifyError(code: string, message: string, extra: object = {}): Error {
  return Object.assign(new Error(message), { code }, extra);
}

describe("toProblem", () => {
  it("maps AppError to itself", () => {
    const problem = toProblem(
      new AppError({
        code: "not-found",
        status: 404,
        title: "Not found",
        detail: "No such survey",
      }),
    );
    expect(problem).toEqual({
      type: `${base}not-found`,
      title: "Not found",
      status: 404,
      code: "not-found",
      detail: "No such survey",
    });
  });

  it("includes errors[] of an AppError", () => {
    const problem = toProblem(
      new AppError({
        code: "validation-failed",
        status: 422,
        title: "Validation failed",
        errors: [{ pointer: "/name", detail: "required" }],
      }),
    );
    expect(problem.errors).toEqual([{ pointer: "/name", detail: "required" }]);
    expect(problem).not.toHaveProperty("detail");
  });

  it("maps body validation errors to 422 validation-failed with JSON pointers", () => {
    const error = fastifyError("FST_ERR_VALIDATION", "body must have required property 'name'", {
      validation: [
        {
          instancePath: "",
          keyword: "required",
          params: { missingProperty: "name" },
          message: "must have required property 'name'",
        },
        { instancePath: "/tags/0", keyword: "type", params: {}, message: "must be string" },
      ],
      validationContext: "body",
      statusCode: 400,
    });
    expect(toProblem(error)).toEqual({
      type: `${base}validation-failed`,
      title: "Validation failed",
      status: 422,
      code: "validation-failed",
      errors: [
        { pointer: "/name", detail: "must have required property 'name'" },
        { pointer: "/tags/0", detail: "must be string" },
      ],
    });
  });

  it.each(["querystring", "params", "headers"])(
    "maps %s validation errors to 400 bad-request",
    (ctx) => {
      const error = fastifyError("FST_ERR_VALIDATION", "x", {
        validation: [
          { instancePath: "/limit", keyword: "maximum", params: {}, message: "must be <= 100" },
        ],
        validationContext: ctx,
        statusCode: 400,
      });
      expect(toProblem(error)).toMatchObject({
        status: 400,
        code: "bad-request",
        errors: [{ pointer: "/limit", detail: "must be <= 100" }],
      });
    },
  );

  it.each([
    "FST_ERR_BAD_URL",
    "FST_ERR_CTP_INVALID_JSON_BODY",
    "FST_ERR_CTP_EMPTY_JSON_BODY",
    "FST_ERR_CTP_INVALID_CONTENT_LENGTH",
  ])("maps %s to 400 bad-request", (code) => {
    expect(toProblem(fastifyError(code, "boom", { statusCode: 400 }))).toMatchObject({
      status: 400,
      code: "bad-request",
    });
  });

  it("maps oversized bodies to 413 payload-too-large", () => {
    expect(
      toProblem(fastifyError("FST_ERR_CTP_BODY_TOO_LARGE", "big", { statusCode: 413 })),
    ).toMatchObject({
      status: 413,
      code: "payload-too-large",
    });
  });

  it("maps unsupported content types to 415 unsupported-media-type", () => {
    expect(
      toProblem(fastifyError("FST_ERR_CTP_INVALID_MEDIA_TYPE", "nope", { statusCode: 415 })),
    ).toMatchObject({
      status: 415,
      code: "unsupported-media-type",
    });
  });

  it("maps anything else to 500 internal-error and hides the message", () => {
    const problem = toProblem(new Error("secret db password in stack"));
    expect(problem).toEqual({
      type: `${base}internal-error`,
      title: "Internal server error",
      status: 500,
      code: "internal-error",
    });
    expect(JSON.stringify(problem)).not.toContain("secret");
  });

  it("maps non-Error throwables to 500", () => {
    expect(toProblem("oops")).toMatchObject({ status: 500, code: "internal-error" });
  });
});
