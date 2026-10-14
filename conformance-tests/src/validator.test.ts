import { openapiPath } from "@my-surveys/contract";
import { beforeAll, describe, expect, it } from "vitest";
import { createValidator, type Validator } from "./validator.js";

const validConfig = {
  edition: "self-hosted",
  shell: "surveyjs-site",
  authMethods: ["surveyjs"],
  surveyjsLicenseKey: null,
  limits: { maxAssetBytesPerSurvey: 1, maxFileBytes: 1, maxResponseBytes: 1 },
};

const problem = (over: Record<string, unknown> = {}) => ({
  type: "https://my-surveys.surveyjs.io/problems/not-implemented",
  title: "Not implemented",
  status: 501,
  code: "not-implemented",
  ...over,
});

function json(body: unknown, status: number, contentType = "application/json"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": contentType } });
}

describe("response validator", () => {
  let validator: Validator;
  beforeAll(async () => {
    validator = await createValidator(openapiPath);
  });

  it("accepts a documented response", async () => {
    expect(await validator.check("GET", "/config", json(validConfig, 200))).toEqual([]);
  });

  it("accepts a content type with parameters", async () => {
    const res = json(validConfig, 200, "application/json; charset=utf-8");
    expect(await validator.check("GET", "/config", res)).toEqual([]);
  });

  it("rejects a body that violates the schema", async () => {
    const res = json({ ...validConfig, edition: "nope" }, 200);
    expect(await validator.check("GET", "/config", res)).not.toEqual([]);
  });

  it("rejects an undocumented status", async () => {
    const res = json(
      problem({ status: 418, code: "bad-request" }),
      418,
      "application/problem+json",
    );
    expect(await validator.check("GET", "/config", res)).toEqual([
      expect.stringContaining("status 418"),
    ]);
  });

  it("rejects a wrong content type", async () => {
    const res = json(validConfig, 200, "text/plain");
    expect(await validator.check("GET", "/config", res)).toEqual([
      expect.stringContaining("content type"),
    ]);
  });

  it("validates an undocumented 501 as a Problem", async () => {
    const ok = json(problem(), 501, "application/problem+json");
    expect(await validator.check("GET", "/surveys", ok)).toEqual([]);
    const bad = json({ nope: true }, 501, "application/problem+json");
    expect(await validator.check("GET", "/surveys", bad)).not.toEqual([]);
  });

  it("rejects a Problem whose code is not in the enum", async () => {
    const res = json(problem({ code: "made-up" }), 501, "application/problem+json");
    expect(await validator.check("GET", "/surveys", res)).not.toEqual([]);
  });

  it("rejects a Problem whose status differs from the HTTP status", async () => {
    const res = json(problem({ status: 500 }), 501, "application/problem+json");
    expect(await validator.check("GET", "/surveys", res)).toEqual([
      expect.stringContaining("status"),
    ]);
  });

  it("rejects an unknown operation", async () => {
    await expect(validator.check("GET", "/nope", json({}, 200))).resolves.toEqual([
      expect.stringContaining("not in the contract"),
    ]);
  });

  it("checks an unrouted Problem against the Problem schema", async () => {
    const ok = json(problem({ status: 404, code: "not-found" }), 404, "application/problem+json");
    expect(await validator.checkProblem(ok)).toEqual([]);
    expect(await validator.checkProblem(json(validConfig, 404))).not.toEqual([]);
  });
});
