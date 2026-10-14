import { openapiPath } from "@my-surveys/contract";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { createValidator, type Validator } from "./validator.js";

const baseUrl = inject("baseUrl");

describe(`server at ${baseUrl}`, () => {
  let validator: Validator;
  beforeAll(async () => {
    validator = await createValidator(openapiPath);
  });

  /** Calls `/api/v1{path}` and fails unless the response conforms to the contract. */
  async function call(method: string, pathTemplate: string, path = pathTemplate) {
    const response = await fetch(`${baseUrl}/api/v1${path}`, { method });
    expect(await validator.check(method, pathTemplate, response)).toEqual([]);
    return { response, body: await response.clone().json() };
  }

  it("getConfig answers 200 with the configuration", async () => {
    const { response } = await call("GET", "/config");
    expect(response.status).toBe(200);
  });

  it("an unimplemented operation answers 501 not-implemented", async () => {
    const { response, body } = await call("GET", "/surveys");
    expect(response.status).toBe(501);
    expect(body).toMatchObject({ code: "not-implemented" });
  });

  it("an unknown route answers 404 not-found", async () => {
    const response = await fetch(`${baseUrl}/api/v1/does-not-exist`);
    expect(response.status).toBe(404);
    expect(await validator.checkProblem(response)).toEqual([]);
    expect(await response.json()).toMatchObject({ code: "not-found" });
  });
});
