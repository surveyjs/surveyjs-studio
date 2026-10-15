import { describe, expect, it } from "vitest";
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
