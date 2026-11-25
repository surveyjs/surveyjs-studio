// The old account actions (hosted Step 6, ADR 0040): generateAccessKey (§13) and
// setGenerationJSONType (§31). A valid key's generateAccessKey has no golden file: with a legacy
// key has no golden file (a recording would replace the test account's key). On the Azure legacy
// provider the bridge forwards it to the old service, which owns the key; on the memory provider
// Studio replaces the key itself and revokes the old one (ADR 0037). With an API token Studio
// rotates the token (api-token.test.ts).
import { describe, expect, it } from "vitest";
import { goldenTests, KEYS, LEGACY_STUB_URL, PROVIDER, send } from "./harness.js";

describe("generateAccessKey", () => goldenTests(["generateAccessKey"]));
describe("setGenerationJSONType", () => goldenTests(["setGenerationJSONType"]));

describe("generateAccessKey with a valid credential", () => {
  const path = "/private/v1/Surveys/generateAccessKey";

  it.skipIf(LEGACY_STUB_URL === null || PROVIDER !== "azure-legacy")(
    "forwards a legacy key's request to the old service unchanged",
    async () => {
      const answer = await send({ method: "GET", path, query: { accessKey: KEYS.accessKey } });
      expect(answer.status).toBe(200);
      expect(answer.headers["x-legacy-stub"]).toBe("1");
      const echo = JSON.parse(answer.body.toString("utf8")) as { method: string; url: string };
      expect(echo).toMatchObject({ method: "GET", url: `${path}?accessKey=${KEYS.accessKey}` });
    },
  );

  // A key no other case uses (the fixtures' user 4, the outsider), because the replace revokes the old key.
  it.skipIf(PROVIDER !== "memory")(
    "replaces a legacy key in Studio and refuses the old key after",
    async () => {
      const oldKey = "access-key-4";
      const answer = await send({ method: "GET", path, query: { accessKey: oldKey } });
      expect(answer.status).toBe(200);
      expect(answer.headers["x-legacy-stub"]).toBeUndefined();
      expect(JSON.parse(answer.body.toString("utf8"))).toMatch(/^[0-9a-f]{32}$/);
      const again = await send({ method: "GET", path, query: { accessKey: oldKey } });
      expect(again.body.toString("utf8")).toBe(`The accessKey '${oldKey}' is incorrect.`);
    },
  );
});
