import { describe, expect, it } from "vitest";
import type { LocalAccount, LocalAccountStore } from "../providers/types.js";
import { LICENCE_EXPIRED, LICENCE_EXPIRES_SOON } from "./account-notices.js";
import { createSignInLicenceNotices } from "./sign-in-licence.js";

const NOW = Date.parse("2026-11-24T12:00:00.000Z");
const DAY_MS = 86_400_000;
const id = "11111111-0000-4000-8000-a00000000001";

function notices(licenceExpiresAt: string | null) {
  const accounts = {
    account: (accountId: string) =>
      Promise.resolve(accountId === id ? ({ licenceExpiresAt } as unknown as LocalAccount) : null),
  } as unknown as LocalAccountStore;
  return createSignInLicenceNotices(accounts, () => NOW);
}

const inDays = (days: number) => new Date(NOW + days * DAY_MS).toISOString();

describe("createSignInLicenceNotices", () => {
  it("gives the expired notice for a past date", async () => {
    expect(await notices(inDays(-1)).noticesFor(id)).toEqual([LICENCE_EXPIRED]);
  });

  it("gives the expires-soon notice 10 days ahead", async () => {
    expect(await notices(inDays(10)).noticesFor(id)).toEqual([LICENCE_EXPIRES_SOON]);
  });

  it("gives none 20 days ahead", async () => {
    expect(await notices(inDays(20)).noticesFor(id)).toEqual([]);
  });

  it("gives none without a date, and for an unknown account", async () => {
    expect(await notices(null).noticesFor(id)).toEqual([]);
    expect(await notices(inDays(-1)).noticesFor("someone-else")).toEqual([]);
  });
});
