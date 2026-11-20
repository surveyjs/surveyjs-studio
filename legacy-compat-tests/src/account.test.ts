// The old account actions (hosted Step 6, ADR 0040): generateAccessKey (§13) and
// setGenerationJSONType (§31). A valid key's generateAccessKey has no golden file: with a legacy
// key the bridge forwards it to the old service, which owns the key (and a recording would replace
// the test account's key); with an API token Studio rotates the token.
import { describe, expect, it, onTestFinished } from "vitest";
import { goldenTests, KEYS, LEGACY_STUB_URL, send } from "./harness.js";
import { studio } from "./studio.js";

describe("generateAccessKey", () => goldenTests(["generateAccessKey"]));
describe("setGenerationJSONType", () => goldenTests(["setGenerationJSONType"]));

describe("generateAccessKey with a valid credential", () => {
  it.skipIf(LEGACY_STUB_URL === null)(
    "forwards a legacy key's request to the old service unchanged",
    async () => {
      const path = "/private/v1/Surveys/generateAccessKey";
      const answer = await send({ method: "GET", path, query: { accessKey: KEYS.accessKey } });
      expect(answer.status).toBe(200);
      expect(answer.headers["x-legacy-stub"]).toBe("1");
      const echo = JSON.parse(answer.body.toString("utf8")) as { method: string; url: string };
      expect(echo).toMatchObject({ method: "GET", url: `${path}?accessKey=${KEYS.accessKey}` });
    },
  );

  it("rotates an API token and answers the new value as a JSON string", async () => {
    const created = await studio("POST", "/api-tokens", {
      name: "Legacy compat rotation",
      projectId: null,
    });
    expect(created.status).toBe(201);
    const { token, value } = (await created.json()) as { token: { id: string }; value: string };
    onTestFinished(async () => void (await studio("DELETE", `/api-tokens/${token.id}`)));

    const answer = await send({
      method: "GET",
      path: "/private/Surveys/generateAccessKey",
      query: { accessKey: value },
    });
    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe("application/json; charset=utf-8");
    const rotated = JSON.parse(answer.body.toString("utf8")) as unknown;
    expect(rotated).toMatch(/^sjs_[A-Za-z0-9_-]{43}$/);
    expect(rotated).not.toBe(value);

    // The old value stops working at once; the new one works.
    const old = await send({
      method: "GET",
      path: "/private/v1/Surveys/getActive",
      query: { accessKey: value },
    });
    expect(old.status).toBe(401);
    const fresh = await send({
      method: "GET",
      path: "/private/v1/Surveys/getActive",
      query: { accessKey: rotated as string },
    });
    expect(fresh.status).toBe(200);
  });
});
