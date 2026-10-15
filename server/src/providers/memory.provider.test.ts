import { describe, expect, it } from "vitest";
import { LICENCE_EXPIRED } from "../notices/account-notices.js";
import { legacyFixtureSeed } from "./azure-legacy/fixtures.js";
import { createMemoryProviders } from "./memory.js";
import { describeProviderSuite } from "./suite/provider-suite.js";

describeProviderSuite("memory (legacy fixture seed)", async () =>
  createMemoryProviders(await legacyFixtureSeed()),
);

describe("memory provider with a user whose legacy email is NULL", () => {
  // A NULL legacy email maps to "". Like azure-legacy, a blank lookup must not find that user.
  const user = {
    id: "eeeeeeee-0000-4000-8000-0000000000e1",
    email: "",
    displayName: "",
    blocked: false,
  };
  const providers = createMemoryProviders({ users: [user], surveys: [], memberships: [] });

  it("finds the user by id but not by a blank email", async () => {
    expect(await providers.directory.getUser(user.id)).toEqual(user);
    expect(await providers.directory.findUserByEmail("")).toBeNull();
    expect(await providers.directory.findUserByEmail(" ")).toBeNull();
  });
});

describe("memory provider account notices", () => {
  const userId = "11111111-0000-4000-8000-a00000000001";

  it("has none by default", async () => {
    expect(await createMemoryProviders().notices.noticesFor(userId)).toEqual([]);
  });

  it("serves the demo notice that ACCOUNT_NOTICES selects", async () => {
    const providers = createMemoryProviders(undefined, { accountNotices: "license-expired" });
    expect(await providers.notices.noticesFor(userId)).toEqual([LICENCE_EXPIRED]);
  });

  it("refuses surveyjs-licenses, which needs the legacy site data", () => {
    expect(() => createMemoryProviders(undefined, { accountNotices: "surveyjs-licenses" })).toThrow(
      /surveyjs-licenses needs STORAGE_PROVIDER=azure-legacy/,
    );
  });
});
