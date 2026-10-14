import { Outlet, createFileRoute, getRouteApi } from "@tanstack/react-router";
import { ApiError } from "../api/client";
import { currentUserQueryOptions, useSignOut } from "../api/session";
import { navigateTo } from "../navigation";
import { renderShell } from "../shell/registry";

/** Pathless layout for pages that need a signed-in user: guards them and renders the shell. */
export const Route = createFileRoute("/_private")({
  beforeLoad: async ({ context, location }) => {
    try {
      const user = await context.queryClient.ensureQueryData(currentUserQueryOptions);
      return { user };
    } catch (error) {
      if (error instanceof ApiError && error.problem.status === 401) {
        const returnTo = encodeURIComponent(location.href);
        navigateTo(`/api/v1/auth/login?returnTo=${returnTo}`);
        // The browser is leaving; never settle, so the page is not rendered meanwhile.
        return new Promise<never>(() => {});
      }
      throw error;
    }
  },
  component: PrivateLayout,
});

const rootRoute = getRouteApi("__root__");

function PrivateLayout() {
  const { user } = Route.useRouteContext();
  const config = rootRoute.useLoaderData();
  const onSignOut = useSignOut();
  return renderShell(config.shell, {
    user,
    notices: user.notices ?? [],
    links: config.links ?? {},
    onSignOut,
    children: <Outlet />,
  });
}
