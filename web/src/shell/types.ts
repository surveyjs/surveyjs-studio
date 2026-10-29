import type { MouseEvent, ReactNode } from "react";
import type { components } from "@surveyjs-studio/contract/types";

export type ShellUser = components["schemas"]["CurrentUser"];
export type ShellNotice = components["schemas"]["Notice"];
/** The instance's branding (`/config.branding`), shown by the powered-by shell. */
export type ShellBranding = components["schemas"]["Branding"];

/** The branding of a server whose `/config` has none (an older server): the defaults. */
export const DEFAULT_BRANDING: ShellBranding = {
  name: "My Surveys",
  logoUrl: null,
  accentColor: "#19b394",
  termsUrl: null,
  privacyUrl: null,
  poweredBy: true,
};

/** A page of the app, for a shell that renders without the router. */
export interface ShellAppLink {
  readonly href: string;
  readonly navigate: () => void;
}

/**
 * The click handler of an app link: a plain left click navigates in the app; a click with another
 * button or a modifier key is left to the browser (a new tab or window).
 */
export function followAppLink(link: ShellAppLink) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    link.navigate();
  };
}

/** What every shell receives; `links` is the `/config.links` map of name to URL. */
export interface ShellProps {
  user: ShellUser;
  notices: ShellNotice[];
  links: Record<string, string>;
  onSignOut: () => void;
  /** True while signing out; the Sign Out control should be disabled. */
  signingOut?: boolean;
  /** A message to show when signing out failed. */
  signOutError?: string | null;
  /**
   * In-app link to the Projects page; the shells render it as a plain link whose plain left click
   * calls `navigate`.
   */
  projectsLink?: ShellAppLink;
  /** In-app link to the change-password page, for an instance with passwords (AUTH_METHODS). */
  changePasswordLink?: ShellAppLink;
  /** In-app link to the Users page, for an instance admin. */
  usersLink?: ShellAppLink;
  /** In-app link to My Surveys (the powered-by shell's header). */
  homeLink?: ShellAppLink;
  /** `/config.branding`; the powered-by shell shows it. */
  branding?: ShellBranding;
  children: ReactNode;
}
