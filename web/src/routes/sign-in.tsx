import { createFileRoute } from "@tanstack/react-router";
import { appPath, searchText } from "../account/returnTo";
import { configQueryOptions } from "../api/config";
import { navigateTo } from "../navigation";

/**
 * The sign-in page of an instance with passwords (`/sign-in?returnTo=`). It sits outside
 * `_private`: the visitor is not signed in yet. A site without passwords leaves for the server's
 * sign-in instead.
 */
export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } => ({
    returnTo: searchText(search["returnTo"]),
  }),
  beforeLoad: async ({ context, search }) => {
    const config = await context.queryClient.ensureQueryData(configQueryOptions);
    if (!config.authMethods.includes("password")) {
      navigateTo(`/api/v1/auth/login?returnTo=${encodeURIComponent(appPath(search.returnTo))}`);
      // The browser is leaving; never settle, so the page is not rendered meanwhile.
      return new Promise<never>(() => {});
    }
  },
});
