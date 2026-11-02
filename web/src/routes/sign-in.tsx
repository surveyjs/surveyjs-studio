import { createFileRoute } from "@tanstack/react-router";
import { isSurveyjsOnly } from "../account/authMethods";
import { appPath, searchText } from "../account/returnTo";
import { configQueryOptions } from "../api/config";
import { navigateTo } from "../navigation";

/**
 * The sign-in page (`/sign-in?returnTo=`): the password form and a link per OAuth2 provider. It sits
 * outside `_private`: the visitor is not signed in yet. A site whose only method is surveyjs.io
 * leaves for the server's sign-in instead.
 */
export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } => ({
    returnTo: searchText(search["returnTo"]),
  }),
  beforeLoad: async ({ context, search }) => {
    const config = await context.queryClient.ensureQueryData(configQueryOptions);
    if (isSurveyjsOnly(config.authMethods)) {
      navigateTo(`/api/v1/auth/login?returnTo=${encodeURIComponent(appPath(search.returnTo))}`);
      // The browser is leaving; never settle, so the page is not rendered meanwhile.
      return new Promise<never>(() => {});
    }
  },
});
