import type { LocalAccountStore } from "../providers/types.js";
import type { AccountNotices } from "./account-notices.js";
import { licenceNotices } from "./licence-rule.js";

/**
 * `ACCOUNT_NOTICES=sign-in-licence`: the notices of the licence date the site sent at the user's
 * last sign-in (`license_expires_at`, stored on the local account). An unknown id has no notice.
 */
export function createSignInLicenceNotices(
  accounts: LocalAccountStore,
  now: () => number = Date.now,
): AccountNotices {
  return {
    async noticesFor(userId) {
      const account = await accounts.account(userId);
      if (account === null) return [];
      const date = account.licenceExpiresAt;
      return licenceNotices(date === null ? [] : [new Date(date)], now());
    },
  };
}
