import { createFileRoute, notFound } from "@tanstack/react-router";
import { configQueryOptions } from "../../api/config";
import { projectsQueryOptions } from "../../api/projects";
import { tokensQueryOptions } from "../../api/tokens";

/** API tokens (`/api-tokens`): the page component is in api-tokens.lazy.tsx. */
export const Route = createFileRoute("/_private/api-tokens")({
  loader: async ({ context: { queryClient } }) => {
    const config = await queryClient.ensureQueryData(configQueryOptions);
    // Without the feature the page does not exist.
    if (!config.features.apiTokens) throw notFound();
    await Promise.all([
      queryClient.ensureQueryData(tokensQueryOptions(null)),
      queryClient.ensureQueryData(projectsQueryOptions),
    ]);
  },
});
