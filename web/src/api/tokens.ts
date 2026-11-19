import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type { components } from "@surveyjs-studio/contract/types";
import { client, toApiError } from "./client";

export type ApiToken = components["schemas"]["ApiToken"];
export type ApiTokenList = components["schemas"]["ApiTokenList"];
export type ApiTokenCreated = components["schemas"]["ApiTokenCreated"];

export const tokenKeys = {
  all: ["api-tokens"] as const,
  /** The user's Personal tokens (`null`) or one project's. */
  list: (projectId: string | null) =>
    ["api-tokens", projectId?.toLowerCase() ?? "personal"] as const,
};

/** The Personal tokens and the legacy key (`projectId` null), or the tokens of one project. */
export const tokensQueryOptions = (projectId: string | null) =>
  queryOptions({
    queryKey: tokenKeys.list(projectId),
    queryFn: async ({ signal }): Promise<ApiTokenList> => {
      const { data, error, response } = await client.GET("/api-tokens", {
        params: { query: projectId === null ? {} : { project: projectId } },
        signal,
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data;
    },
  });

/** Every write reads the lists again when it is done, also when it failed. */
function useRefreshTokens() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: tokenKeys.all });
}

/**
 * Creates a token; the answer holds the value, which exists nowhere else. The caller keeps it in
 * component state only while it is shown. The mutation is dropped from the cache (`gcTime: 0`) as
 * soon as no component observes it, and `reset()` clears what the observer holds.
 */
export function useCreateToken() {
  const refresh = useRefreshTokens();
  return useMutation({
    mutationFn: async (body: { name: string; projectId: string | null }) => {
      const { data, error, response } = await client.POST("/api-tokens", { body });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data;
    },
    // The answer holds the value: the cache must not keep it once the dialog that shows it is gone.
    gcTime: 0,
    onSettled: refresh,
  });
}

export function useRevokeToken() {
  const refresh = useRefreshTokens();
  return useMutation({
    mutationFn: async (tokenId: string) => {
      const { error, response } = await client.DELETE("/api-tokens/{tokenId}", {
        params: { path: { tokenId } },
      });
      if (!response.ok) throw toApiError(error, response);
    },
    onSettled: refresh,
  });
}

export function useRevokeLegacyKey() {
  const refresh = useRefreshTokens();
  return useMutation({
    mutationFn: async () => {
      const { error, response } = await client.DELETE("/api-tokens/legacy-key");
      if (!response.ok) throw toApiError(error, response);
    },
    onSettled: refresh,
  });
}
