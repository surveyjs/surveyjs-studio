import { useId } from "react";
import type { ShellNotice } from "../types";
import { iconHtml } from "./icons";
import type { LicenceNoticeCode } from "./licenceNotice";
import { SiteButton } from "./SiteButton";

const BANNER_CLASS: Readonly<Record<LicenceNoticeCode, string>> = {
  "license-expired": "v2-class---banner v2-class---banner--licences-expired",
  "license-expires-soon": "v2-class---banner v2-class---banner--licences-expires-soon",
};

export interface LicenceNoticeDialogProps {
  notice: ShellNotice & { code: LicenceNoticeCode };
  /** The Help Desk link of the second paragraph (`/config.links.helpDesk`). */
  helpDeskUrl: string | undefined;
  /** "Later", and "Renew" before it leaves: the site remembers both as a dismissal. */
  onDismiss: () => void;
}

/**
 * The site's licence dialogs (`the site's page markup` and
 * `the site's page markup`). The headline is the notice's message and "Renew" opens the
 * notice's action link; the paragraphs are the site's.
 */
export function LicenceNoticeDialog({ notice, helpDeskUrl, onDismiss }: LicenceNoticeDialogProps) {
  const titleId = useId();
  return (
    <div
      className={BANNER_CLASS[notice.code]}
      style={{ display: "block" }}
      role="dialog"
      aria-labelledby={titleId}
    >
      <div className="v2-class---banner__content">
        <div className="v2-class---banner__title-container">
          <div
            className="v2-class---banner__title-icon"
            dangerouslySetInnerHTML={iconHtml("Warning-24-24")}
          />
          <h3 className="v2-class---banner__title" id={titleId}>
            {notice.message}
          </h3>
        </div>

        <p className="v2-class---banner__paragraph">
          Since the license is perpetual, you will still have permanent access to the product
          versions released within the first 12 month of the original purchase date.
        </p>

        <p className="v2-class---banner__paragraph">
          If you wish to continue receiving technical support from our{" "}
          {helpDeskUrl ? (
            <a className="v2-class---paragraph-link" href={helpDeskUrl}>
              Help Desk
            </a>
          ) : (
            "Help Desk"
          )}{" "}
          specialists and maintain access to the latest product updates, make sure to renew your
          subscription by clicking the &quot;Renew&quot; button below.
        </p>

        <div className="v2-class---banner-footer-actions">
          {notice.actionUrl && (
            <div className="v2-class---banner__button-container">
              <SiteButton
                text={notice.actionLabel ?? "Renew"}
                style="Accent"
                mode="Primary"
                size="Medium"
                href={notice.actionUrl}
                onClick={onDismiss}
              />
            </div>
          )}
          <a
            href="#"
            role="button"
            className="v2-class---paragraph-link"
            onClick={(event) => {
              event.preventDefault();
              onDismiss();
            }}
          >
            Later
          </a>
        </div>
      </div>
    </div>
  );
}
