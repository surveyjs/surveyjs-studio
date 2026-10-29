import type { CSSProperties, ReactNode } from "react";
import { followAppLink, type ShellBranding, type ShellProps } from "../types";
import styles from "./PoweredByShell.module.css";

const SURVEYJS_URL = "https://surveyjs.io";

/** The accent colour as the custom property the shell's styles read. */
const accentStyle = (branding: ShellBranding) =>
  ({ "--brand-accent": branding.accentColor }) as CSSProperties;

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
 * of a visitor who is not signed in (sign-in, set-password, public results).
 */
export function PoweredByFrame({
  branding,
  header,
  children,
}: {
  branding: ShellBranding;
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.frame} style={accentStyle(branding)}>
      <header className={styles.header}>
        <span className={styles.brand}>
          {branding.logoUrl !== null && (
            <img className={styles.logo} src={branding.logoUrl} alt={branding.name} />
          )}
          <span>{branding.name}</span>
        </span>
        {header}
      </header>
      <main className={styles.main}>{children}</main>
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
  branding,
  children,
}: ShellProps & { branding: ShellBranding }) {
  const appLinks = [
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
    <PoweredByFrame branding={branding} header={header}>
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
