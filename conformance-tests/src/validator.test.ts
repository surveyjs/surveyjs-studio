import { openapiPath } from "@my-surveys/contract";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createValidator, type Validator } from "./validator.js";

const fixturePath = fileURLToPath(new URL("./fixtures/things.yaml", import.meta.url));

const problem = (over: Record<string, unknown> = {}) => ({
  type: "https://example.test/problems/not-found",
  title: "Not found",
  status: 404,
  code: "not-found",
  ...over,
});

const JSON_TYPE = { "content-type": "application/json" };
const PROBLEM_TYPE = { "content-type": "application/problem+json" };
const okHeaders = { ...JSON_TYPE, etag: '"1"', "retry-after": "5" };

const omit = (headers: Record<string, string>, name: string) =>
  Object.fromEntries(Object.entries(headers).filter(([key]) => key !== name));

function respond(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  const payload = body === undefined || typeof body === "string" ? body : JSON.stringify(body);
  return new Response(payload as string | undefined, { status, headers });
}

describe("validator (fixture contract)", () => {
  let v: Validator;
  beforeAll(async () => {
    v = await createValidator(fixturePath);
  });

  const thing = (headers: Record<string, string>, body: unknown = { name: "a" }) =>
    v.check("GET", "/things/{id}", respond(200, body, headers));

  it("accepts a documented response on a templated path", async () => {
    expect(await thing(okHeaders)).toEqual([]);
  });

  it("rejects a body that violates the schema", async () => {
    expect(await thing(okHeaders, {})).not.toEqual([]);
  });

  it("rejects a body that is not JSON", async () => {
    expect(await thing(okHeaders, "{nope")).toEqual([expect.stringContaining("not valid JSON")]);
  });

  it("rejects an unknown method and an unknown path", async () => {
    expect(await v.check("PUT", "/things/{id}", respond(200))).toEqual([
      expect.stringContaining("not in the contract"),
    ]);
    expect(await v.check("GET", "/things/42", respond(200))).toEqual([
      expect.stringContaining("not in the contract"),
    ]);
  });

  it("resolves a $ref'd response", async () => {
    const ok = respond(404, problem(), PROBLEM_TYPE);
    expect(await v.check("GET", "/things/{id}", ok)).toEqual([]);
  });

  it("rejects a Problem with a code outside the enum or a mismatched status", async () => {
    const badCode = respond(404, problem({ code: "x" }), PROBLEM_TYPE);
    expect(await v.check("GET", "/things/{id}", badCode)).not.toEqual([]);
    const badStatus = respond(404, problem({ status: 500 }), PROBLEM_TYPE);
    expect(await v.check("GET", "/things/{id}", badStatus)).toEqual([
      expect.stringContaining("differs from HTTP status"),
    ]);
  });

  it("falls back to the default response", async () => {
    // default documents text/plain: the media type is accepted, a JSON one is not.
    const wrongType = respond(418, "{}", JSON_TYPE);
    expect(await v.check("GET", "/things/{id}", wrongType)).toEqual([
      expect.stringContaining("content type"),
    ]);
    const ok = respond(418, '"teapot"', { "content-type": "text/plain; charset=utf-8" });
    expect(await v.check("GET", "/things/{id}", ok)).toEqual([]);
  });

  it("rejects an undocumented status when there is no default", async () => {
    expect(await v.check("DELETE", "/things/{id}", respond(200))).toEqual([
      expect.stringContaining("status 200 is not documented"),
    ]);
  });

  it("accepts 204 without a body and rejects one with a body", async () => {
    expect(await v.check("DELETE", "/things/{id}", respond(204))).toEqual([]);
    expect(await v.check("GET", "/empty", respond(200))).toEqual([]);
    expect(await v.check("GET", "/empty", respond(200, "x"))).toEqual([
      expect.stringContaining("documents no body"),
    ]);
  });

  it("accepts a media type without a schema", async () => {
    const ok = respond(200, "a,b", { "content-type": "text/csv" });
    expect(await v.check("GET", "/files", ok)).toEqual([]);
  });

  it("validates documented and undocumented 501 as Problems", async () => {
    const nope = problem({ status: 501, code: "not-implemented" });
    expect(await v.check("DELETE", "/things/{id}", respond(501, nope, PROBLEM_TYPE))).toEqual([]);
    expect(await v.check("GET", "/files", respond(501, nope, PROBLEM_TYPE))).toEqual([]);
    expect(await v.check("GET", "/files", respond(501, { nope: 1 }, PROBLEM_TYPE))).not.toEqual([]);
    expect(await v.check("GET", "/files", respond(501, nope, JSON_TYPE))).toEqual([
      expect.stringContaining("content type"),
    ]);
  });

  it("requires a declared required header", async () => {
    const without = omit(okHeaders, "etag");
    expect(await thing(without)).toEqual([expect.stringContaining("header ETag is required")]);
  });

  it("requires a required header declared through a $ref", async () => {
    const without = omit(okHeaders, "retry-after");
    expect(await thing(without)).toEqual([
      expect.stringContaining("header Retry-After is required"),
    ]);
  });

  it("validates a present header against its schema, coercing numbers", async () => {
    expect(await thing({ ...okHeaders, "x-rate": "fast" })).toEqual([
      expect.stringContaining("header X-Rate"),
    ]);
    expect(await thing({ ...okHeaders, "retry-after": "-1" })).toEqual([
      expect.stringContaining("header Retry-After"),
    ]);
    expect(await thing({ ...okHeaders, "x-rate": "10" })).toEqual([]);
  });

  it("does not require an optional header", async () => {
    expect(await thing(okHeaders)).toEqual([]);
  });

  it("checks an unrouted Problem against the Problem schema", async () => {
    expect(await v.checkProblem(respond(404, problem(), PROBLEM_TYPE))).toEqual([]);
    expect(await v.checkProblem(respond(404, { a: 1 }, JSON_TYPE))).not.toEqual([]);
  });
});

describe("validator (real contract, smoke)", () => {
  it("accepts getConfig and rejects a bad edition", async () => {
    const v = await createValidator(openapiPath);
    const config = {
      edition: "self-hosted",
      shell: "surveyjs-site",
      authMethods: ["surveyjs"],
      surveyjsLicenseKey: null,
      limits: {
        maxAssetBytesPerSurvey: 1,
        maxFileBytes: 1,
        maxResponseBytes: 1,
        maxDocumentBytes: 1,
      },
    };
    expect(await v.check("GET", "/config", respond(200, config, JSON_TYPE))).toEqual([]);
    const bad = respond(200, { ...config, edition: "x" }, JSON_TYPE);
    expect(await v.check("GET", "/config", bad)).not.toEqual([]);
  });
});
