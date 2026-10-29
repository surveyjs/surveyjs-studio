import { createFileRoute } from "@tanstack/react-router";
import { projectsPageQueryOptions } from "../../api/projects";

/** Projects (`/projects`): the page component is in projects.lazy.tsx. */
export const Route = createFileRoute("/_private/projects")({
  loader: ({ context: { queryClient, user } }) =>
    queryClient.ensureQueryData(projectsPageQueryOptions(user.instanceRole)),
});
