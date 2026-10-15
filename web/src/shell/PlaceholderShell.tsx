import type { ReactNode } from "react";

export interface ShellUser {
  name: string;
}

export interface ShellNotice {
  id: string;
  text: string;
}

export interface ShellLink {
  label: string;
  href: string;
}

export interface ShellProps {
  user?: ShellUser;
  notices?: ShellNotice[];
  links?: ShellLink[];
  children: ReactNode;
}

/** Placeholder shell: header with the app name, main, footer. The real shells arrive in a later step. */
export function PlaceholderShell({ user, notices = [], links = [], children }: ShellProps) {
  return (
    <>
      <header>
        <strong>My Surveys</strong>
        {links.length > 0 && (
          <nav>
            {links.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
        )}
        {user && <span>{user.name}</span>}
      </header>
      {notices.map((notice) => (
        <div key={notice.id} role="status">
          {notice.text}
        </div>
      ))}
      <main>{children}</main>
      <footer>My Surveys</footer>
    </>
  );
}
