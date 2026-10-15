import { queryOptions } from "@tanstack/react-query";
import type { components } from "@my-surveys/contract/types";
import { client, toApiError } from "./client";

export type Project = components["schemas"]["Project"];

const PROJECT_PAGE_SIZE = 200;

export const projectKeys = {
  all: ["projects"] as const,
  list: () => ["projects", "list"] as const,
  detail: (projectId: string) => ["projects", "detail", projectId] as const,
};

/** Every project of the user, as one array: follows `nextCursor` until the last page. */
export const projectsQueryOptions = queryOptions({
  queryKey: projectKeys.list(),
  queryFn: async ({ signal }) => {
    const projects: Project[] = [];
    let cursor: string | undefined;
    do {
      const { data, error, response } = await client.GET("/projects", {
        params: { query: { limit: PROJECT_PAGE_SIZE, cursor } },
        signal,
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      projects.push(...data.items);
      cursor = data.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return projects;
  },
});

export const projectQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: projectKeys.detail(projectId),
    queryFn: async ({ signal }) => {
      const { data, error, response } = await client.GET("/projects/{projectId}", {
        params: { path: { projectId } },
        signal,
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data;
    },
  });
