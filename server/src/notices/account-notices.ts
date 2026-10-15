import type { components } from "@my-surveys/contract";
import type { AccountNoticesSetting } from "../config.js";
import { DEFAULT_SHELL_LINKS } from "../shell-links.js";

export type Notice = components["schemas"]["Notice"];

/**
 * Account notices for the signed-in user (`CurrentUser.notices`), such as the surveyjs.io licence
 * expiry. Part of the provider set; `ACCOUNT_NOTICES` selects the implementation.
 */
export interface AccountNotices {
  /** The notices to show to the user with this id; `[]` when there are none. */
  noticesFor(userId: string): Promise<Notice[]>;
}

/**
 * Where the surveyjs.io licence dialogs send the "Renew" button: the account's licence page, which
 * is the Account menu's Settings link. `linkNotices` repoints it to the configured `settings` link.
 */
const RENEW_URL = DEFAULT_SHELL_LINKS.settings;

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

/** The shell link each notice's action opens, by notice code. */
const ACTION_LINKS: Readonly<Record<string, string>> = {
  [LICENCE_EXPIRED.code]: "settings",
  [LICENCE_EXPIRES_SOON.code]: "settings",
};

/**
 * Points each notice's action at its shell link (`/config.links`, so `SHELL_LINKS` repoints the
 * Settings menu item and the Renew button in one place). A notice whose link is missing keeps its
 * own `actionUrl`.
 */
export function linkNotices(
  notices: readonly Notice[],
  links: Readonly<Record<string, string>>,
): Notice[] {
  return notices.map((notice): Notice => {
    const name = Object.hasOwn(ACTION_LINKS, notice.code) ? ACTION_LINKS[notice.code] : undefined;
    const url = name !== undefined && Object.hasOwn(links, name) ? links[name] : undefined;
    return url === undefined ? notice : { ...notice, actionUrl: url };
  });
}

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
