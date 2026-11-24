// The old account actions (hosted Step 6, ADR 0040): generateAccessKey (§13) and
// setGenerationJSONType (§31). A valid key's generateAccessKey has no golden file: with a legacy
// key the bridge forwards it to the old service, which owns the key (and a recording would replace
// the test account's key); with an API token Studio rotates the token (api-token.test.ts).
import { describe, expect, it } from "vitest";
import { goldenTests, KEYS, LEGACY_STUB_URL, send } from "./harness.js";

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
});
