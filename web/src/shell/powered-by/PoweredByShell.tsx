import type { CSSProperties, ReactNode } from "react";
import { followAppLink, type ShellAppLink, type ShellBranding, type ShellProps } from "../types";
import { accentTextColor } from "./accentText";
import styles from "./PoweredByShell.module.css";

const SURVEYJS_URL = "https://surveyjs.io";

/**
 * The accent colour as the custom properties the shell's styles read: `--brand-accent` for lines,
 * `--brand-accent-text` (a shade that reads on white) for text.
 */
const accentStyle = (branding: ShellBranding) =>
  ({
    "--brand-accent": branding.accentColor,
    "--brand-accent-text": accentTextColor(branding.accentColor),
  }) as CSSProperties;

/**
 * The footer of the powered-by shell: Terms and Privacy when configured, and "Powered by SurveyJS"
 * unless BRANDING=off. Alone it ends a page without the shell (the run page); nothing when there
 * is nothing to show.
 */
export function PoweredByFooter({ branding }: { branding: ShellBranding }) {
  if (!branding.poweredBy && branding.termsUrl === null && branding.privacyUrl === null) {
    return null;
  }
  return (
    // data-branding-footer: the editor page hides the other shells' footers, never this one.
    <footer className={styles.footer} style={accentStyle(branding)} data-branding-footer="">
      {branding.termsUrl !== null && <a href={branding.termsUrl}>Terms</a>}
      {branding.privacyUrl !== null && <a href={branding.privacyUrl}>Privacy</a>}
      {branding.poweredBy && (
        <a href={SURVEYJS_URL} target="_blank" rel="noopener noreferrer">
          Powered by SurveyJS
        </a>
      )}
    </footer>
  );
}

/**
 * The powered-by frame: a header with the instance's logo and name (and `header`, the account
 * controls of a signed-in page), the page, and the footer. Without `header` it frames the pages
 * of a visitor who is not signed in (sign-in, set-password, public results). The logo and name link
 * to My Surveys (`homeLink` in the app, else a page load of `/`). `ownMain`: the page brings its own
 * `<main>` (the public results page), so the frame adds none.
 */
export function PoweredByFrame({
  branding,
  header,
  homeLink,
  ownMain = false,
  children,
}: {
  branding: ShellBranding;
  header?: ReactNode;
  homeLink?: ShellAppLink;
  ownMain?: boolean;
  children: ReactNode;
}) {
  const Main = ownMain ? "div" : "main";
  return (
    <div className={styles.frame} style={accentStyle(branding)}>
      <header className={styles.header}>
        <a
          className={styles.brand}
          href={homeLink?.href ?? "/"}
          onClick={homeLink ? followAppLink(homeLink) : undefined}
        >
          {/* The name next to it says what the logo shows. */}
          {branding.logoUrl !== null && (
            <img className={styles.logo} src={branding.logoUrl} alt="" />
          )}
          <span>{branding.name}</span>
        </a>
        {header}
      </header>
      <Main className={styles.main}>{children}</Main>
      <PoweredByFooter branding={branding} />
    </div>
  );
}

/** The self-hosted shell (APP_SHELL=powered-by): the instance's branding around the app's pages. */
export function PoweredByShell({
  user,
  notices,
  onSignOut,
  signingOut,
  signOutError,
  projectsLink,
  changePasswordLink,
  usersLink,
  homeLink,
  branding,
  children,
}: ShellProps & { branding: ShellBranding }) {
  const appLinks = [
    { text: "My Surveys", link: homeLink },
    { text: "Projects", link: projectsLink },
    { text: "Users", link: usersLink },
    { text: "Change password", link: changePasswordLink },
  ];
  const header = (
    <nav className={styles.nav} aria-label="Account">
      {appLinks.map(
        ({ text, link }) =>
          link && (
            <a key={text} href={link.href} onClick={followAppLink(link)}>
              {text}
            </a>
          ),
      )}
      <span>{user.displayName}</span>
      <button type="button" className={styles.signOut} onClick={onSignOut} disabled={signingOut}>
        Sign Out
      </button>
    </nav>
  );
  return (
    <PoweredByFrame branding={branding} header={header} {...(homeLink && { homeLink })}>
      {signOutError && (
        <div className={styles.message} role="alert">
          {signOutError}
        </div>
      )}
      {notices.map((notice) => (
        <div key={notice.code} className={styles.message} role="status">
          {notice.message}
          {notice.actionUrl && <a href={notice.actionUrl}>{notice.actionLabel ?? "Learn more"}</a>}
        </div>
      ))}
      {children}
    </PoweredByFrame>
  );
}
