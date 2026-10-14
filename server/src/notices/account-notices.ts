import type { components } from "@my-surveys/contract";
import type { AccountNoticesSetting } from "../config.js";

export type Notice = components["schemas"]["Notice"];

/**
 * Account notices for the signed-in user (`CurrentUser.notices`), such as the surveyjs.io licence
 * expiry. Part of the provider set; `ACCOUNT_NOTICES` selects the implementation.
 */
export interface AccountNotices {
  /** The notices to show to the user with this id; `[]` when there are none. */
  noticesFor(userId: string): Promise<Notice[]>;
}

/** Where the surveyjs.io licence dialogs send the "Renew" button: the account's licence page. */
const RENEW_URL = "https://surveyjs.io/manage";

/** The surveyjs.io "renewal subscription has expired" dialog (layout document, section 3.15). */
export const LICENCE_EXPIRED: Readonly<Notice> = Object.freeze({
  code: "license-expired",
  message: "Your renewal subscription has expired.",
  actionUrl: RENEW_URL,
  actionLabel: "Renew",
});

/** The surveyjs.io "renewal subscription expires soon" dialog (layout document, section 3.15). */
export const LICENCE_EXPIRES_SOON: Readonly<Notice> = Object.freeze({
  code: "license-expires-soon",
  message: "Your renewal subscription expires soon.",
  actionUrl: RENEW_URL,
  actionLabel: "Renew",
});

export type DemoNoticesSetting = Exclude<AccountNoticesSetting, "surveyjs-licenses">;

const DEMO: Record<DemoNoticesSetting, readonly Readonly<Notice>[]> = {
  none: [],
  "license-expired": [LICENCE_EXPIRED],
  "license-expires-soon": [LICENCE_EXPIRES_SOON],
};

/** The demo settings of `ACCOUNT_NOTICES`: every user gets the same notice (or none). */
export function demoAccountNotices(setting: DemoNoticesSetting): AccountNotices {
  const notices = DEMO[setting];
  return { noticesFor: () => Promise.resolve(notices.map((notice) => ({ ...notice }))) };
}
