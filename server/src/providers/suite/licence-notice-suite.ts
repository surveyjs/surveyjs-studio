import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../../auth/session.js";
import type { AccountNotices } from "../../notices/account-notices.js";
import {
  ADMIN_ID,
  LATER_LICENCE_CLOCK,
  LICENCE_CLOCK,
  OWNER_ID,
  adminLicenceBoundary,
  expiredNotice,
  licenceNoticesAtClock,
  licenceNoticesAtLaterClock,
} from "./expected.js";

export interface NoticesHandle {
  readonly notices: AccountNotices;
  close(): Promise<void>;
}

/**
 * Licence-expiry notices (`ACCOUNT_NOTICES=surveyjs-licenses`) against the golden licence
 * fixtures. `create` returns a provider that reads them and uses the given clock. Only providers
 * that hold licence data run it (azure-legacy, the user-API stub); the demo settings have their own unit tests.
 */
export function describeLicenceNoticeSuite(
  name: string,
  create: (now: Clock) => Promise<NoticesHandle>,
): void {
  describe(`licence notice suite: ${name}`, () => {
    let clock = LICENCE_CLOCK;
    let providers: NoticesHandle;
    beforeAll(async () => {
      providers = await create(() => clock);
    });
    afterAll(async () => {
      await providers.close();
    });
    beforeEach(() => {
      clock = LICENCE_CLOCK;
    });

    it.each(licenceNoticesAtClock)("gives %s the expected notices", async (_name, id, notices) => {
      expect(await providers.notices.noticesFor(id)).toEqual(notices);
    });

    it.each(licenceNoticesAtLaterClock)(
      "a year later, gives %s the expected notices",
      async (_name, id, notices) => {
        clock = LATER_LICENCE_CLOCK;
        expect(await providers.notices.noticesFor(id)).toEqual(notices);
      },
    );

    it.each(adminLicenceBoundary)(
      "applies the 'soon' boundary: at %s the admin's licence gives %s",
      async (at, _label, notices) => {
        clock = Date.parse(at);
        expect(await providers.notices.noticesFor(ADMIN_ID)).toEqual(notices);
      },
    );

    it("matches the user id case-insensitively", async () => {
      expect(await providers.notices.noticesFor(OWNER_ID.toUpperCase())).toEqual([expiredNotice]);
    });

    it("gives no notice to an unknown user or an id that is not a GUID", async () => {
      expect(await providers.notices.noticesFor("99999999-9999-4999-8999-999999999999")).toEqual(
        [],
      );
      expect(await providers.notices.noticesFor("not-a-guid")).toEqual([]);
    });
  });
}
