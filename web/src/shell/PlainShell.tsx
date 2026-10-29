import type { ReactNode } from "react";
import { followAppLink, type ShellProps } from "./types";

/** Minimal shell: app name, links, the user with a Sign Out button, notices, main, footer. */
export function PlainShell({
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
  return (
    <ShellFrame>
      <header>
        <strong>My Surveys</strong>
        {projectsLink && (
          <a href={projectsLink.href} onClick={followAppLink(projectsLink)}>
            Projects
          </a>
        )}
        {usersLink && (
          <a href={usersLink.href} onClick={followAppLink(usersLink)}>
            Users
          </a>
        )}
        {Object.keys(links).length > 0 && (
          <nav>
            {Object.entries(links).map(([name, href]) => (
              <a key={name} href={href}>
                {name}
              </a>
            ))}
          </nav>
        )}
        <span>{user.displayName}</span>
        {changePasswordLink && (
          <a href={changePasswordLink.href} onClick={followAppLink(changePasswordLink)}>
            Change password
          </a>
        )}
        <button type="button" onClick={onSignOut} disabled={signingOut}>
          Sign Out
        </button>
      </header>
      {signOutError && <div role="alert">{signOutError}</div>}
      {notices.map((notice) => (
        <div key={notice.code} role="status">
          {notice.message}
          {notice.actionUrl && <a href={notice.actionUrl}>{notice.actionLabel ?? "Learn more"}</a>}
        </div>
      ))}
      <main>{children}</main>
    </ShellFrame>
  );
}

/** Used when no user is known (the error state): the same frame without account controls. */
export function AnonymousShell({ children }: { children: ReactNode }) {
  return (
    <ShellFrame>
      <header>
        <strong>My Surveys</strong>
      </header>
      <main>{children}</main>
    </ShellFrame>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <footer>My Surveys</footer>
    </>
  );
}
