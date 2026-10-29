import {
  Outlet,
  createFileRoute,
  getRouteApi,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { ApiError } from "../api/client";
import { configQueryOptions } from "../api/config";
import { currentUserQueryOptions, useSignOut } from "../api/session";
import { navigateTo } from "../navigation";
import { renderShell } from "../shell/registry";

/** Pathless layout for pages that need a signed-in user: guards them and renders the shell. */
export const Route = createFileRoute("/_private")({
  beforeLoad: async ({ context, location }) => {
    let user;
    try {
      user = await context.queryClient.ensureQueryData(currentUserQueryOptions);
    } catch (error) {
      if (error instanceof ApiError && error.problem.status === 401) {
        // With passwords the sign-in page is the app's own; else the server's login leaves for
        // the identity provider.
        const config = await context.queryClient.ensureQueryData(configQueryOptions);
        if (config.authMethods.includes("password")) {
          throw redirect({ to: "/sign-in", search: { returnTo: location.href } });
        }
        navigateTo(`/api/v1/auth/login?returnTo=${encodeURIComponent(location.href)}`);
        // The browser is leaving; never settle, so the page is not rendered meanwhile.
        return new Promise<never>(() => {});
      }
      throw error;
    }
    // A password someone else chose (the first admin's ADMIN_PASSWORD) is changed before anything
    // else: the server refuses the other operations meanwhile (password-change-required).
    if (user.mustChangePassword === true && location.pathname !== "/change-password") {
      throw redirect({ to: "/change-password", search: { returnTo: location.href } });
    }
    return { user };
  },
  component: PrivateLayout,
});

const rootRoute = getRouteApi("__root__");

function PrivateLayout() {
  const { user } = Route.useRouteContext();
  const config = rootRoute.useLoaderData();
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
    projectsLink: { href: "/projects", navigate: () => void navigate({ to: "/projects" }) },
    homeLink: { href: "/", navigate: () => void navigate({ to: "/" }) },
    ...(config.authMethods.includes("password") && {
      changePasswordLink: {
        href: "/change-password",
        navigate: () => void navigate({ to: "/change-password" }),
      },
    }),
    ...(user.instanceRole === "admin" && {
      usersLink: {
        href: "/admin/users",
        navigate: () => void navigate({ to: "/admin/users" }),
      },
    }),
    children: <Outlet />,
  });
}
