import { describe, expect, it } from "vitest";
import {
  demoAccountNotices,
  LICENCE_EXPIRED,
  LICENCE_EXPIRES_SOON,
  linkNotices,
} from "./account-notices.js";

const userId = "11111111-0000-4000-8000-a00000000001";

describe("licence notices", () => {
  it("use the codes, headlines and Renew link of the surveyjs.io licence dialogs", () => {
    expect(LICENCE_EXPIRED).toEqual({
      code: "license-expired",
      message: "Your renewal subscription has expired.",
      actionUrl: "https://surveyjs.io/manage",
      actionLabel: "Renew",
    });
    expect(LICENCE_EXPIRES_SOON).toEqual({
      code: "license-expires-soon",
      message: "Your renewal subscription expires soon.",
      actionUrl: "https://surveyjs.io/manage",
      actionLabel: "Renew",
    });
  });
});

describe("demoAccountNotices", () => {
  it("gives every user no notice with ACCOUNT_NOTICES=none", async () => {
    expect(await demoAccountNotices("none").noticesFor(userId)).toEqual([]);
  });

  it("gives every user the expired notice with ACCOUNT_NOTICES=license-expired", async () => {
    const notices = demoAccountNotices("license-expired");
    expect(await notices.noticesFor(userId)).toEqual([LICENCE_EXPIRED]);
    expect(await notices.noticesFor("someone-else")).toEqual([LICENCE_EXPIRED]);
  });

  it("gives every user the expires-soon notice with ACCOUNT_NOTICES=license-expires-soon", async () => {
    expect(await demoAccountNotices("license-expires-soon").noticesFor(userId)).toEqual([
      LICENCE_EXPIRES_SOON,
    ]);
  });

  it("returns copies, so a caller cannot change the next answer", async () => {
    const notices = demoAccountNotices("license-expired");
    const [first] = await notices.noticesFor(userId);
    first!.message = "changed";
    expect(await notices.noticesFor(userId)).toEqual([LICENCE_EXPIRED]);
  });
});

describe("linkNotices", () => {
  const other = { code: "something-else", message: "Other", actionUrl: "https://a.example/" };

  it("points the licence notices' Renew link at the settings link", () => {
    const links = { settings: "https://account.example.com/", billing: "https://b.example/" };
    expect(linkNotices([LICENCE_EXPIRED, LICENCE_EXPIRES_SOON], links)).toEqual([
      { ...LICENCE_EXPIRED, actionUrl: "https://account.example.com/" },
      { ...LICENCE_EXPIRES_SOON, actionUrl: "https://account.example.com/" },
    ]);
  });

  it("keeps a notice's own link when it has no shell link or the link is missing", () => {
    expect(linkNotices([other], { settings: "https://account.example.com/" })).toEqual([other]);
    expect(linkNotices([LICENCE_EXPIRED], {})).toEqual([LICENCE_EXPIRED]);
  });
});
