import { useLayoutEffect, type CSSProperties, type ReactNode } from "react";
import { followAppLink, type ShellAppLink, type ShellBranding, type ShellProps } from "../types";
import { accentTextColor } from "./accentText";
import "./self-hosted.css";
import "./self-hosted-pages.css";

/**
 * The self-hosted shell (APP_SHELL=self-hosted): a plain site frame for an instance of its own — a
 * header with the instance's logo and name, the main navigation and the account, the page, and a
 * footer. Its only tie to SurveyJS is the "Powered by SurveyJS" mark. Its styles are its own
 * (`self-hosted.css`, `self-hosted-pages.css`), with readable global class names (`sh-*`), so a fork
 * can restyle or replace it; see docs/customizing/branding.md.
 */

const SURVEYJS_URL = "https://surveyjs.io";

/**
 * The accent colour as the custom properties the stylesheet reads: `--sh-accent` for lines and
 * buttons, `--sh-accent-text` (a shade that reads on white, 4.5:1) for text.
 */
const accentStyle = (branding: ShellBranding) =>
  ({
    "--sh-accent": branding.accentColor,
    "--sh-accent-text": accentTextColor(branding.accentColor),
  }) as CSSProperties;

/**
 * The footer: Terms and Privacy when configured, and "Powered by SurveyJS" unless BRANDING=off.
 * Alone (`standalone`) it ends a page without the frame, the run page; nothing when there is
 * nothing to show.
 */
export function SelfHostedFooter({
  branding,
  standalone = false,
}: {
  branding: ShellBranding;
  standalone?: boolean;
}) {
  if (!branding.poweredBy && branding.termsUrl === null && branding.privacyUrl === null) {
    return null;
  }
  return (
    // data-branding-footer: the editor page hides the other shells' footers, never this one.
    <footer
      className={standalone ? "sh-footer sh-footer--standalone" : "sh-footer"}
      style={standalone ? accentStyle(branding) : undefined}
      data-branding-footer=""
    >
      {branding.termsUrl !== null && (
        <a className="sh-footer__link" href={branding.termsUrl}>
          Terms
        </a>
      )}
      {branding.privacyUrl !== null && (
        <a className="sh-footer__link" href={branding.privacyUrl}>
          Privacy
        </a>
      )}
      {branding.poweredBy && (
        <a
          className="sh-footer__link sh-footer__powered-by"
          href={SURVEYJS_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by SurveyJS <span className="sh-visually-hidden">(opens in a new tab)</span>
        </a>
      )}
    </footer>
  );
}

/**
 * The frame: the header with the logo and name (linking to My Surveys: `homeLink` in the app, else a
 * page load of `/`) and `header` (the navigation and account of a signed-in page), the page, and the
 * footer. Without `header` it frames the pages of a visitor who is not signed in (sign-in,
 * set-password, public results). `ownMain`: the page brings its own `<main>` (the public results
 * page), so the frame adds none.
 */
export function SelfHostedFrame({
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
  // A layout effect runs before the passive effects of the pages inside, so a page that sets its
  // own title (run, public results) still wins.
  useLayoutEffect(() => {
    document.title = branding.name;
  }, [branding.name]);
  const Content = ownMain ? "div" : "main";
  return (
    <div className="sh-app" style={accentStyle(branding)}>
      <header className="sh-header">
        <a
          className="sh-brand"
          href={homeLink?.href ?? "/"}
          onClick={homeLink ? followAppLink(homeLink) : undefined}
        >
          {/* The name next to it says what the logo shows. */}
          {branding.logoUrl !== null && (
            <img className="sh-brand__logo" src={branding.logoUrl} alt="" />
          )}
          <span className="sh-brand__name">{branding.name}</span>
        </a>
        {header}
      </header>
      <Content className="sh-content">{children}</Content>
      <SelfHostedFooter branding={branding} />
    </div>
  );
}

/** The self-hosted shell of a signed-in page. */
export function SelfHostedShell({
  user,
  notices,
  onSignOut,
  signingOut,
  signOutError,
  homeLink,
  projectsLink,
  usersLink,
  changePasswordLink,
  branding,
  children,
}: ShellProps & { branding: ShellBranding }) {
  const navigation = [
    { text: "My Surveys", link: homeLink },
    { text: "Projects", link: projectsLink },
    { text: "Users", link: usersLink },
  ];
  const header = (
    <>
      <nav className="sh-nav" aria-label="Main">
        {navigation.map(
          ({ text, link }) =>
            link && (
              <a key={text} className="sh-nav__link" href={link.href} onClick={followAppLink(link)}>
                {text}
              </a>
            ),
        )}
      </nav>
      <div className="sh-account">
        <span className="sh-account__name">{user.displayName}</span>
        {changePasswordLink && (
          <a
            className="sh-account__link"
            href={changePasswordLink.href}
            onClick={followAppLink(changePasswordLink)}
          >
            Change password
          </a>
        )}
        <button type="button" className="sh-button" onClick={onSignOut} disabled={signingOut}>
          Sign Out
        </button>
      </div>
    </>
  );
  return (
    <SelfHostedFrame branding={branding} header={header} {...(homeLink && { homeLink })}>
      {signOutError && (
        <div className="sh-message sh-message--error" role="alert">
          {signOutError}
        </div>
      )}
      {notices.map((notice) => (
        <div key={notice.code} className="sh-message" role="status">
          {notice.message}
          {notice.actionUrl && <a href={notice.actionUrl}>{notice.actionLabel ?? "Learn more"}</a>}
        </div>
      ))}
      {children}
    </SelfHostedFrame>
  );
}
