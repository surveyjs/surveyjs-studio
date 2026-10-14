import { LICENCE_EXPIRED, LICENCE_EXPIRES_SOON, type Notice } from "./account-notices.js";

const DAY_MS = 86_400_000;

/**
 * A licence "expires soon" while at most this many **whole** days are left: the legacy rule counts
 * the whole days of the remaining time, so it starts 15 days (exactly) before the expiry.
 */
export const EXPIRES_SOON_WHOLE_DAYS = 14;

/**
 * The surveyjs.io licence-expiry rule (layout document, section 3.15), for a user who has not
 * dismissed a dialog (My Surveys cannot see the surveyjs.io dismissals):
 *
 * - a licence without an expiry date is ignored;
 * - a licence is expired once its expiry instant is in the past;
 * - otherwise it expires soon while fewer than 15 whole days are left;
 * - any expired licence gives the expired notice; else any licence that expires soon gives the
 *   expires-soon notice; else there is no notice.
 *
 * `expiries` holds one entry per licence of the user; `now` is epoch milliseconds.
 */
export function licenceNotices(expiries: readonly (Date | null)[], now: number): Notice[] {
  let soon = false;
  for (const expiry of expiries) {
    if (expiry === null) continue;
    const left = expiry.getTime() - now;
    if (left < 0) return [{ ...LICENCE_EXPIRED }];
    if (Math.floor(left / DAY_MS) <= EXPIRES_SOON_WHOLE_DAYS) soon = true;
  }
  return soon ? [{ ...LICENCE_EXPIRES_SOON }] : [];
}
