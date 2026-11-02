import { describe, expect, it } from "vitest";
import { legacyFixtureSeed } from "./azure-legacy/fixtures.js";
import { createMemoryProviders } from "./memory.js";
import { PROJECT_A_ID } from "./suite/expected.js";
import { seedInvitation, withSeedInvitation } from "./seed-invitations.js";
import { createSeededSqlProviders } from "./sql-suite-setup.js";

describe("the shared seed's invitation", () => {
  it("is for the Marketing project and is not part of the legacy fixtures", async () => {
    expect(seedInvitation).toMatchObject({ projectId: PROJECT_A_ID, email: "invited@example.com" });
    expect((await legacyFixtureSeed()).invitations).toBeUndefined();
  });

  it("is loaded by the memory provider with a local directory only", async () => {
    const seed = withSeedInvitation(await legacyFixtureSeed());
    const local = createMemoryProviders(seed, { userDirectory: "local" });
    expect(await local.invitations!.listInvitations(PROJECT_A_ID)).toEqual([seedInvitation]);
    expect(createMemoryProviders(seed).invitations).toBeNull();
  });

  it("is loaded by the SQL seed, and the member list does not change", async () => {
    const providers = await createSeededSqlProviders("sqlite", undefined, { localAccounts: true });
    try {
      expect(await providers.invitations!.listInvitations(PROJECT_A_ID)).toEqual([seedInvitation]);
      expect(await providers.invitations!.hasInvitation("INVITED@example.com")).toBe(true);
    } finally {
      await providers.close();
    }
    const plain = await createSeededSqlProviders("sqlite");
    try {
      expect(plain.invitations).toBeNull();
    } finally {
      await plain.close();
    }
  });
});
