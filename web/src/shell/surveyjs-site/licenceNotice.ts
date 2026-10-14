import { useState } from "react";
import type { ShellNotice } from "../types";
import { readStored, writeStored } from "./storage";

export type LicenceNoticeCode = "license-expired" | "license-expires-soon";

/**
 * Where the site remembers that a licence dialog was dismissed ("Later" or "Renew"): the dismissal
 * time, as `Date.toUTCString()`. While the key is set the site never shows that dialog again in the
 * browser (the account icon stops twinkling too); the Settings item keeps its warning.
 */
export const DISMISSAL_KEYS: Readonly<Record<LicenceNoticeCode, string>> = {
  "license-expired": "expiredNotificationDateTime",
  "license-expires-soon": "expiresSoonNotificationDateTime",
};

/** The licence notice to act on: "expired" wins over "expires soon", as on the site. */
function licenceNoticeOf(notices: readonly ShellNotice[]) {
  return (
    notices.find((notice) => notice.code === "license-expired") ??
    notices.find((notice) => notice.code === "license-expires-soon")
  );
}

export interface LicenceNoticeState {
  /** The licence notice of the user, if any (drives the Settings warning). */
  notice: (ShellNotice & { code: LicenceNoticeCode }) | undefined;
  /** Whether its dialog is shown (it was not dismissed in this browser). */
  open: boolean;
  /** Hides the dialog and remembers that, as the site's "Later" and "Renew" do. */
  dismiss: () => void;
}

export function useLicenceNotice(notices: readonly ShellNotice[]): LicenceNoticeState {
  const notice = licenceNoticeOf(notices) as LicenceNoticeState["notice"];
  const key = notice ? DISMISSAL_KEYS[notice.code] : undefined;
  // The dismissals made in this page view; the stored ones are read on each render.
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const open = key !== undefined && !dismissed.includes(key) && readStored(key) === null;
  return {
    notice,
    open,
    dismiss: () => {
      if (key === undefined) return;
      writeStored(key, new Date().toUTCString());
      setDismissed((keys) => [...keys, key]);
    },
  };
}
