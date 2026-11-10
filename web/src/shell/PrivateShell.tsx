import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { components } from "@surveyjs-studio/contract/types";
import { useSignOut } from "../api/session";
import { underBase } from "../basePath";
import { renderShell } from "./registry";

type AppConfig = components["schemas"]["AppConfig"];
type CurrentUser = components["schemas"]["CurrentUser"];

/** The configured shell around the page of a signed-in user, with its links and Sign Out. */
export function PrivateShell({
  config,
  user,
  children,
}: {
  config: AppConfig;
  user: CurrentUser;
  children: ReactNode;
}) {
  const { signOut, pending, error } = useSignOut();
  const navigate = useNavigate();
  return renderShell(config.shell, {
    user,
    notices: user.notices ?? [],
    links: config.links ?? {},
    ...(config.branding && { branding: config.branding }),
    onSignOut: signOut,
    signingOut: pending,
    signOutError: error,
    // The shells render without the router: they get the link and a function that follows it.
    // The `href` is for the browser (a new tab), so under the base path; `navigate` is the router's.
    projectsLink: {
      href: underBase("/projects"),
      navigate: () => void navigate({ to: "/projects" }),
    },
    homeLink: { href: underBase("/"), navigate: () => void navigate({ to: "/" }) },
    ...(config.authMethods.includes("password") &&
      user.hasPassword !== false && {
        changePasswordLink: {
          href: underBase("/change-password"),
          navigate: () => void navigate({ to: "/change-password" }),
        },
      }),
    ...(user.instanceRole === "admin" && {
      usersLink: {
        href: underBase("/admin/users"),
        navigate: () => void navigate({ to: "/admin/users" }),
      },
    }),
    children,
  });
}
