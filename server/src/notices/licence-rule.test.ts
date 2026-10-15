import { describe, expect, it } from "vitest";
import { LICENCE_EXPIRED, LICENCE_EXPIRES_SOON } from "./account-notices.js";
import { licenceNotices } from "./licence-rule.js";

const DAY = 86_400_000;
const expiry = new Date("2026-09-10T00:00:00.000Z");
const at = (offsetMs: number): number => expiry.getTime() + offsetMs;

describe("licenceNotices (the legacy licence-expiry rule)", () => {
  it("gives no notice without licences", () => {
    expect(licenceNotices([], at(0))).toEqual([]);
  });

  it("ignores a licence without an expiry date", () => {
    expect(licenceNotices([null], at(0))).toEqual([]);
  });

  it("gives no notice while 15 or more whole days are left", () => {
    expect(licenceNotices([expiry], at(-15 * DAY))).toEqual([]);
    expect(licenceNotices([expiry], at(-400 * DAY))).toEqual([]);
  });

  it("says the licence expires soon once fewer than 15 whole days are left", () => {
    expect(licenceNotices([expiry], at(-15 * DAY + 1))).toEqual([LICENCE_EXPIRES_SOON]);
    expect(licenceNotices([expiry], at(-14 * DAY))).toEqual([LICENCE_EXPIRES_SOON]);
    expect(licenceNotices([expiry], at(-1))).toEqual([LICENCE_EXPIRES_SOON]);
  });

  it("still says expires soon at the expiry instant itself", () => {
    expect(licenceNotices([expiry], at(0))).toEqual([LICENCE_EXPIRES_SOON]);
  });

  it("says the licence expired once the expiry instant has passed", () => {
    expect(licenceNotices([expiry], at(1))).toEqual([LICENCE_EXPIRED]);
    expect(licenceNotices([expiry], at(800 * DAY))).toEqual([LICENCE_EXPIRED]);
  });

  it("lets an expired licence win over one that expires soon or is valid", () => {
    const expired = new Date(at(-DAY));
    const soon = new Date(at(3 * DAY));
    const valid = new Date(at(300 * DAY));
    expect(licenceNotices([valid, soon, expired], at(0))).toEqual([LICENCE_EXPIRED]);
    expect(licenceNotices([valid, null, soon], at(0))).toEqual([LICENCE_EXPIRES_SOON]);
  });

  it("returns copies, so a caller cannot change the shared notices", () => {
    const [notice] = licenceNotices([expiry], at(1));
    notice!.message = "changed";
    expect(licenceNotices([expiry], at(1))).toEqual([LICENCE_EXPIRED]);
    expect(LICENCE_EXPIRED.message).not.toBe("changed");
  });
});
