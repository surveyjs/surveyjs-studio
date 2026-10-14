import type { ReactNode } from "react";
import type { components } from "@my-surveys/contract/types";

export type ShellUser = components["schemas"]["CurrentUser"];
export type ShellNotice = components["schemas"]["Notice"];

/** What every shell receives; `links` is the `/config.links` map of name to URL. */
export interface ShellProps {
  user: ShellUser;
  notices: ShellNotice[];
  links: Record<string, string>;
  onSignOut: () => void;
  children: ReactNode;
}
