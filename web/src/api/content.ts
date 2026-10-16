import { infiniteQueryOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import type { components } from "@my-surveys/contract/types";
import { ApiError, client, toApiError } from "./client";
import { scopeOf, surveyKeys, type Survey } from "./surveys";

export type SurveyDefinition = components["schemas"]["SurveyDefinition"];
export type SurveyTheme = components["schemas"]["SurveyTheme"];
export type HistoryPage = components["schemas"]["HistoryPage"];

/** A document and the ETag it was read or written with. */
export interface VersionedDocument<T> {
  readonly content: T;
  readonly etag: string;
}

export const HISTORY_PAGE_SIZE = 50;

export const contentKeys = {
  definition: (surveyId: string) => ["content", surveyId.toLowerCase(), "definition"] as const,
  theme: (surveyId: string) => ["content", surveyId.toLowerCase(), "theme"] as const,
  history: (surveyId: string) => ["content", surveyId.toLowerCase(), "history"] as const,
};

function etagOf(response: Response): string {
  const etag = response.headers.get("ETag");
  if (etag !== null && etag !== "") return etag;
  throw new ApiError({
    type: "about:blank",
    title: "The server did not send an ETag",
    status: response.status,
    code: "internal-error",
  });
}

/**
 * The editor reads a document once per open: a cached older version would conflict at the first
 * save, and a refetch under the editor would replace what the user is typing into.
 */
const freshReadOnce = {
  staleTime: Infinity,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  gcTime: 0,
} as const;

export const definitionQueryOptions = (surveyId: string) =>
  queryOptions({
    queryKey: contentKeys.definition(surveyId),
    ...freshReadOnce,
    queryFn: async ({ signal }): Promise<VersionedDocument<SurveyDefinition>> => {
      const { data, error, response } = await client.GET("/surveys/{surveyId}/definition", {
        params: { path: { surveyId } },
        signal,
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return { content: data, etag: etagOf(response) };
    },
  });

export const themeQueryOptions = (surveyId: string) =>
  queryOptions({
    queryKey: contentKeys.theme(surveyId),
    ...freshReadOnce,
    queryFn: async ({ signal }): Promise<VersionedDocument<SurveyTheme>> => {
      const { data, error, response } = await client.GET("/surveys/{surveyId}/theme", {
        params: { path: { surveyId } },
        signal,
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return { content: data, etag: etagOf(response) };
    },
  });

/** Saves the definition with `If-Match`; resolves to the new ETag. A 412 rejects with `edit-conflict`. */
export async function saveDefinition(
  surveyId: string,
  content: SurveyDefinition,
  etag: string,
): Promise<string> {
  const { error, response } = await client.PUT("/surveys/{surveyId}/definition", {
    params: { path: { surveyId }, header: { "If-Match": etag } },
    body: content,
  });
  if (!response.ok) throw toApiError(error, response);
  return etagOf(response);
}

/** Saves the theme with `If-Match`; resolves to the new ETag. A 412 rejects with `edit-conflict`. */
export async function saveTheme(
  surveyId: string,
  content: SurveyTheme,
  etag: string,
): Promise<string> {
  const { error, response } = await client.PUT("/surveys/{surveyId}/theme", {
    params: { path: { surveyId }, header: { "If-Match": etag } },
    body: content,
  });
  if (!response.ok) throw toApiError(error, response);
  return etagOf(response);
}

export const historyInfiniteQueryOptions = (surveyId: string) =>
  infiniteQueryOptions({
    queryKey: contentKeys.history(surveyId),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<HistoryPage> => {
      const { data, error, response } = await client.GET("/surveys/{surveyId}/history", {
        params: {
          path: { surveyId },
          query: { limit: HISTORY_PAGE_SIZE, cursor: pageParam ?? undefined },
        },
        signal,
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data;
    },
    getNextPageParam: (page) => page.nextCursor,
    ...freshReadOnce,
  });

/**
 * A save changed `updatedAt` and added a history entry: mark the survey's lists and history stale
 * without refetching now. The next visit refetches them.
 */
export function markSavedContentStale(queryClient: QueryClient, survey: Survey): void {
  void queryClient.invalidateQueries({
    queryKey: surveyKeys.listsOf(scopeOf(survey)),
    refetchType: "none",
  });
  void queryClient.invalidateQueries({
    queryKey: contentKeys.history(survey.id),
    refetchType: "none",
  });
}
