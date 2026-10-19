import { createFileRoute } from "@tanstack/react-router";
import { projectsQueryOptions } from "../../api/projects";

/** Projects (`/projects`): the page component is in projects.lazy.tsx. */
export const Route = createFileRoute("/_private/projects")({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(projectsQueryOptions),
});
