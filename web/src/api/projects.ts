import { queryOptions, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { components } from "@surveyjs-studio/contract/types";
import { client, toApiError } from "./client";
import { surveyKeys } from "./surveys";

export type Project = components["schemas"]["Project"];
export type Member = components["schemas"]["Member"];
export type ProjectRole = components["schemas"]["ProjectRole"];

const PAGE_SIZE = 200;

export const projectKeys = {
  all: ["projects"] as const,
  list: () => ["projects", "list"] as const,
  /** An instance admin's list of every project (`scope=all`). */
  allList: () => ["projects", "all"] as const,
  detail: (projectId: string) => ["projects", "detail", projectId] as const,
  /** Under `all`: every project or member write refreshes the open member lists too (R24). */
  members: (projectId: string) => ["projects", "members", projectId.toLowerCase()] as const,
};

/** Every project of the scope, as one array: follows `nextCursor` until the last page. */
async function allProjects(scope: "member" | "all", signal: AbortSignal): Promise<Project[]> {
  const projects: Project[] = [];
  let cursor: string | undefined;
  do {
    const { data, error, response } = await client.GET("/projects", {
      params: { query: { limit: PAGE_SIZE, cursor, ...(scope === "all" && { scope }) } },
      signal,
    });
    if (!response.ok || data === undefined) throw toApiError(error, response);
    projects.push(...data.items);
    cursor = data.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return projects;
}

/** The user's projects (`member`), or every project of the instance (`all`, instance admins). */
const projectListQueryOptions = (scope: "member" | "all") =>
  queryOptions({
    queryKey: scope === "all" ? projectKeys.allList() : projectKeys.list(),
    queryFn: ({ signal }) => allProjects(scope, signal),
  });

/** Every project of the user (My Surveys' selector, Move, the Projects page). */
export const projectsQueryOptions = projectListQueryOptions("member");

/** The Projects page's list: every project for an instance admin (S17), else the user's. */
export const projectsPageQueryOptions = (instanceRole: string | undefined) =>
  projectListQueryOptions(instanceRole === "admin" ? "all" : "member");

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

/** Every member of the project, as one array: follows `nextCursor` until the last page. */
export const membersQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: projectKeys.members(projectId),
    queryFn: async ({ signal }) => {
      const members: Member[] = [];
      let cursor: string | undefined;
      do {
        const { data, error, response } = await client.GET("/projects/{projectId}/members", {
          params: { path: { projectId }, query: { limit: PAGE_SIZE, cursor } },
          signal,
        });
        if (!response.ok || data === undefined) throw toApiError(error, response);
        members.push(...data.items);
        cursor = data.nextCursor ?? undefined;
      } while (cursor !== undefined);
      return members;
    },
  });

/**
 * After a create, a rename or a member change (R24): everything under `["projects"]` is stale — the
 * list (selector, Move flyout, page, the user's role and member counts), the details and the open
 * member lists. Resolves when the shown ones are read again.
 */
export function refreshProjects(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: projectKeys.all });
}

/**
 * After the user left the project or deleted it (R24): the list is read again first, so its card goes
 * away before its queries do; then the project's detail, members and cached survey lists are dropped.
 * A deletion also refreshes the personal lists (which received the surveys) and the cached survey
 * details (their `projectId` changed).
 */
export async function forgetProject(
  queryClient: QueryClient,
  projectId: string,
  { deleted }: { readonly deleted: boolean },
): Promise<void> {
  // Both lists: the user's, and an instance admin's list of every project (the Projects page).
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: projectKeys.list() }),
    queryClient.invalidateQueries({ queryKey: projectKeys.allList() }),
  ]);
  for (const queryKey of [
    projectKeys.detail(projectId),
    projectKeys.members(projectId),
    surveyKeys.listsOf(projectId),
    surveyKeys.hasArchived(projectId),
  ]) {
    queryClient.removeQueries({ queryKey });
  }
  // The user may have lost access to surveys of the project, so cached details go on a leave too.
  await queryClient.invalidateQueries({ queryKey: ["surveys", "detail"] });
  if (deleted) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: surveyKeys.listsOf("personal") }),
      queryClient.invalidateQueries({ queryKey: surveyKeys.hasArchived("personal") }),
    ]);
  }
}

const MERGE_PATCH = { "Content-Type": "application/merge-patch+json" } as const;

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<Project> => {
      const { data, error, response } = await client.POST("/projects", { body: { name } });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data;
    },
    onSuccess: () => refreshProjects(queryClient),
  });
}

export function useRenameProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectId,
      name,
    }: {
      projectId: string;
      name: string;
    }): Promise<Project> => {
      const { data, error, response } = await client.PATCH("/projects/{projectId}", {
        params: { path: { projectId } },
        body: { name },
        headers: MERGE_PATCH,
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data;
    },
    onSuccess: () => refreshProjects(queryClient),
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string): Promise<void> => {
      const { error, response } = await client.DELETE("/projects/{projectId}", {
        params: { path: { projectId } },
      });
      if (!response.ok) throw toApiError(error, response);
    },
    onSuccess: (_void, projectId) => forgetProject(queryClient, projectId, { deleted: true }),
  });
}

/** Adds a registered user by email, always as `user` (R22; the generated type needs the role). */
export function useAddMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectId,
      email,
    }: {
      projectId: string;
      email: string;
    }): Promise<Member> => {
      const { data, error, response } = await client.POST("/projects/{projectId}/members", {
        params: { path: { projectId } },
        body: { email, role: "user" },
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data;
    },
    onSuccess: () => refreshProjects(queryClient),
  });
}

export function useChangeMemberRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectId,
      userId,
      role,
    }: {
      projectId: string;
      userId: string;
      role: ProjectRole;
    }): Promise<Member> => {
      const { data, error, response } = await client.PATCH(
        "/projects/{projectId}/members/{userId}",
        {
          params: { path: { projectId, userId } },
          body: { role },
          headers: MERGE_PATCH,
        },
      );
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data;
    },
    onSuccess: () => refreshProjects(queryClient),
  });
}

/** Withdraws the invitation of a pending member (an email that has not signed in yet). */
export function useRemoveInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectId,
      email,
    }: {
      projectId: string;
      email: string;
    }): Promise<void> => {
      const { error, response } = await client.DELETE("/projects/{projectId}/invitations/{email}", {
        params: { path: { projectId, email } },
      });
      if (!response.ok) throw toApiError(error, response);
    },
    onSuccess: () => refreshProjects(queryClient),
  });
}

/** Removes a member; `self` is the user leaving the project. */
export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectId,
      userId,
    }: {
      projectId: string;
      userId: string;
      self: boolean;
    }): Promise<void> => {
      const { error, response } = await client.DELETE("/projects/{projectId}/members/{userId}", {
        params: { path: { projectId, userId } },
      });
      if (!response.ok) throw toApiError(error, response);
    },
    onSuccess: (_void, { projectId, self }) =>
      self
        ? forgetProject(queryClient, projectId, { deleted: false })
        : refreshProjects(queryClient),
  });
}
