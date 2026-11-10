import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type { components } from "@surveyjs-studio/contract/types";
import { client, toApiError } from "./client";

export type AdminUser = components["schemas"]["AdminUser"];
export type PasswordLink = components["schemas"]["PasswordLink"];
export type LinkedIdentity = components["schemas"]["LinkedIdentity"];
type AdminUserCreate = components["schemas"]["AdminUserCreate"];
type AdminUserPatch = components["schemas"]["AdminUserPatch"];

const PAGE_SIZE = 200;
const MERGE_PATCH = { "Content-Type": "application/merge-patch+json" };

export const adminKeys = {
  users: ["admin", "users"] as const,
  identities: (userId: string) => ["admin", "users", userId, "identities"] as const,
};

/** Every user of the instance, as one array: follows `nextCursor` until the last page. */
export const usersQueryOptions = queryOptions({
  queryKey: adminKeys.users,
  queryFn: async ({ signal }) => {
    const users: AdminUser[] = [];
    let cursor: string | undefined;
    do {
      const { data, error, response } = await client.GET("/admin/users", {
        params: { query: { limit: PAGE_SIZE, cursor } },
        signal,
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      users.push(...data.items);
      cursor = data.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return users;
  },
});

/**
 * Each write reads the list again when it is done, also when it failed; the users' sign-ins too
 * (their keys start with the list's).
 */
function useRefreshUsers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: adminKeys.users });
}

/** Creates an invited user; the answer holds the one-time link. */
export function useCreateUser() {
  const refresh = useRefreshUsers();
  return useMutation({
    mutationFn: async (body: AdminUserCreate) => {
      const { data, error, response } = await client.POST("/admin/users", { body });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data;
    },
    onSettled: refresh,
  });
}

/** Changes a user's instance role or status. */
export function useUpdateUser() {
  const refresh = useRefreshUsers();
  return useMutation({
    mutationFn: async ({ userId, patch }: { userId: string; patch: AdminUserPatch }) => {
      const { data, error, response } = await client.PATCH("/admin/users/{userId}", {
        params: { path: { userId } },
        body: patch,
        headers: MERGE_PATCH,
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data;
    },
    onSettled: refresh,
  });
}

/** Deletes a user and erases their data. */
export function useDeleteUser() {
  const refresh = useRefreshUsers();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error, response } = await client.DELETE("/admin/users/{userId}", {
        params: { path: { userId } },
      });
      if (!response.ok) throw toApiError(error, response);
    },
    onSettled: refresh,
  });
}

/** Resets a user's password; the answer holds the new one-time link. It unlinks their sign-ins too. */
export function useResetLink() {
  const refresh = useRefreshUsers();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, error, response } = await client.POST("/admin/users/{userId}/reset-link", {
        params: { path: { userId } },
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data;
    },
    onSettled: refresh,
  });
}

/** A user's linked Google, GitHub, Facebook and surveyjs.io sign-ins. */
export const identitiesQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: adminKeys.identities(userId),
    queryFn: async ({ signal }) => {
      const { data, error, response } = await client.GET("/admin/users/{userId}/identities", {
        params: { path: { userId } },
        signal,
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data.items;
    },
  });

/** Unlinks one of a user's sign-ins; their sessions end. */
export function useUnlinkIdentity() {
  const refresh = useRefreshUsers();
  return useMutation({
    mutationFn: async ({ userId, identity }: { userId: string; identity: LinkedIdentity }) => {
      const { error, response } = await client.DELETE(
        "/admin/users/{userId}/identities/{provider}/{subject}",
        { params: { path: { userId, provider: identity.provider, subject: identity.subject } } },
      );
      if (!response.ok) throw toApiError(error, response);
    },
    onSettled: refresh,
  });
}
