import { describe, expect, inject, it } from "vitest";
import { call, signedIn } from "./harness.js";
import { fixtureUsers } from "./sign-in.js";

// Runs its cases only in the user-API mode (`pnpm test:conformance:user-api`): the user directory is
// the surveyjs.io user API (its stub) and the licence notices come from it. The rest of the suite
// covers sign-in and members by email in that mode too.
describe.runIf(inject("userDirectory") === "surveyjs-api")("user directory: surveyjs-api", () => {
  it("getCurrentUser gives the user of the API with the licence notice", async (ctx) => {
    const session = await signedIn(ctx, fixtureUsers.owner.id);
    const response = await call("GET", "/me", { headers: { cookie: session.jar.header() } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { displayName: string; notices: { code: string }[] };
    expect(body.displayName).toBe("Olivia Owner");
    // One of Olivia's licences ended on 2026-08-01, which is past for good.
    expect(body.notices).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "license-expired" })]),
    );
  });

  it("getCurrentUser gives a user without licences no notice", async (ctx) => {
    const session = await signedIn(ctx, fixtureUsers.erasable.id);
    const response = await call("GET", "/me", { headers: { cookie: session.jar.header() } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { notices: unknown[] };
    expect(body.notices).toEqual([]);
  });
});
