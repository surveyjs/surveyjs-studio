import { useEffect, useState } from "react";
import type { ShellProps } from "../types";
import "./assets/surveyjs-site.scss";
import { CookieBanner } from "./CookieBanner";
import { Footer } from "./Footer";
import { Header, type MobileMenu } from "./Header";
import { LicenceNoticeDialog } from "./LicenceNoticeDialog";
import { useLicenceNotice } from "./licenceNotice";
import styles from "./SurveyjsSiteShell.module.css";

/** The site toggles this body class while a mobile menu is open (the site's mobile-menu script). */
const MOBILE_MENU_BODY_CLASS = "v2-class---body--mobile-menu-opened";

/**
 * The surveyjs.io look (D14): the site's top bar, footer, cookie banner and licence dialogs around
 * the page, in the site's page layout.
 */
export function SurveyjsSiteShell({
  user,
  notices,
  links,
  onSignOut,
  signingOut,
  signOutError,
  projectsLink,
  changePasswordLink,
  usersLink,
  children,
}: ShellProps) {
  const licence = useLicenceNotice(notices);
  const [mobileMenu, setMobileMenu] = useState<MobileMenu | null>(null);

  useEffect(() => {
    document.body.classList.toggle(MOBILE_MENU_BODY_CLASS, mobileMenu !== null);
    return () => document.body.classList.remove(MOBILE_MENU_BODY_CLASS);
  }, [mobileMenu]);

  return (
    <>
      <Header
        user={user}
        links={links}
        onSignOut={onSignOut}
        signingOut={signingOut}
        projectsLink={projectsLink}
        changePasswordLink={changePasswordLink}
        usersLink={usersLink}
        licenceWarning={licence.notice !== undefined}
        twinkling={licence.open}
        mobileMenu={mobileMenu}
        onMobileMenu={setMobileMenu}
      />

      <main>
        <div className="v2-class---mobile-menu-overlay" onClick={() => setMobileMenu(null)}></div>
        {signOutError && (
          <p className={styles.signOutError} role="alert">
            {signOutError}
          </p>
        )}
        {children}
      </main>

      <Footer />

      <CookieBanner />
      {licence.notice && licence.open && (
        <LicenceNoticeDialog
          notice={licence.notice}
          helpDeskUrl={Object.hasOwn(links, "helpDesk") ? links["helpDesk"] : undefined}
          onDismiss={licence.dismiss}
        />
      )}
    </>
  );
}
