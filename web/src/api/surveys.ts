import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import type { components } from "@my-surveys/contract/types";
import { client, toApiError } from "./client";

export type Survey = components["schemas"]["Survey"];
export type SurveyPage = components["schemas"]["SurveyPage"];

/** The contract's default page size. */
export const SURVEY_PAGE_SIZE = 50;

export interface SurveyListScope {
  /** `personal` or a project id. */
  project: string;
  archived: boolean;
}

export const surveyKeys = {
  all: ["surveys"] as const,
  /** The prefix of both archived states of one project's lists. */
  listsOf: (project: string) => ["surveys", "list", project] as const,
  list: ({ project, archived }: SurveyListScope) => ["surveys", "list", project, archived] as const,
  hasArchived: (project: string) => ["surveys", "has-archived", project] as const,
  detail: (surveyId: string) => ["surveys", "detail", surveyId] as const,
};

export const surveyListQueryOptions = (scope: SurveyListScope) =>
  infiniteQueryOptions({
    queryKey: surveyKeys.list(scope),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<SurveyPage> => {
      const { data, error, response } = await client.GET("/surveys", {
        params: {
          query: {
            project: scope.project,
            archived: scope.archived,
            limit: SURVEY_PAGE_SIZE,
            cursor: pageParam ?? undefined,
          },
        },
        signal,
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data;
    },
    getNextPageParam: (page) => page.nextCursor,
  });

/** Whether the project (or personal scope) has any archived survey. */
export const hasArchivedQueryOptions = (project: string) =>
  queryOptions({
    queryKey: surveyKeys.hasArchived(project),
    queryFn: async ({ signal }) => {
      const { data, error, response } = await client.GET("/surveys", {
        params: { query: { project, archived: true, limit: 1 } },
        signal,
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data.items.length > 0;
    },
  });

export const surveyQueryOptions = (surveyId: string) =>
  queryOptions({
    queryKey: surveyKeys.detail(surveyId),
    queryFn: async ({ signal }) => {
      const { data, error, response } = await client.GET("/surveys/{surveyId}", {
        params: { path: { surveyId } },
        signal,
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data;
    },
  });

/**
 * Makes a created survey visible at once: stores its detail, puts it at the top of the scope's cached
 * active list, and marks the scope's lists stale so they refetch the next time they are shown.
 *
 * The cache key uses the server's lower-case `projectId`: a hand-typed upper-case project id in the URL
 * is refreshed by the list's own refetch on mount (default `staleTime` 0), not by this update.
 */
export function addCreatedSurvey(queryClient: QueryClient, survey: Survey): void {
  const project = survey.projectId ?? "personal";
  queryClient.setQueryData(surveyKeys.detail(survey.id), survey);
  queryClient.setQueryData<InfiniteData<SurveyPage, string | null>>(
    surveyKeys.list({ project, archived: false }),
    (cached) => {
      if (cached === undefined) return undefined;
      if (cached.pages.some((page) => page.items.some((item) => item.id === survey.id))) {
        return cached;
      }
      const [first, ...rest] = cached.pages;
      if (first === undefined) return cached;
      return { ...cached, pages: [{ ...first, items: [survey, ...first.items] }, ...rest] };
    },
  );
  void queryClient.invalidateQueries({
    queryKey: surveyKeys.listsOf(project),
    refetchType: "none",
  });
}

/** Creates a survey with the server's default name in `project` (`personal` or a project id). */
export function useCreateSurvey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (project: string): Promise<Survey> => {
      const { data, error, response } = await client.POST("/surveys", {
        body: { projectId: project === "personal" ? null : project },
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data;
    },
    onSuccess: (survey) => addCreatedSurvey(queryClient, survey),
  });
}

export type SurveyPatch = components["schemas"]["SurveyPatch"];

const scopeOf = (survey: Survey) => survey.projectId ?? "personal";

type SurveyListData = InfiniteData<SurveyPage, string | null>;

/** Replaces (`replacement`) or removes (`undefined`) the item with `id` in every cached survey list. */
function patchCachedLists(
  queryClient: QueryClient,
  id: string,
  decide: (project: string, archived: boolean) => Survey | undefined,
): void {
  for (const [key, cached] of queryClient.getQueriesData<SurveyListData>({
    queryKey: ["surveys", "list"],
  })) {
    if (cached === undefined) continue;
    const [, , project, archived] = key as readonly [string, string, string, boolean];
    const replacement = decide(project, archived);
    queryClient.setQueryData<SurveyListData>(key, {
      ...cached,
      pages: cached.pages.map((page) => ({
        ...page,
        items:
          replacement === undefined
            ? page.items.filter((item) => item.id !== id)
            : page.items.map((item) => (item.id === id ? replacement : item)),
      })),
    });
  }
}

/**
 * Applies an updated survey to the cache: the detail is replaced, the item is replaced in place in
 * the list it still belongs to and removed from the others, the lists of both scopes are refreshed
 * (so they re-sort), and the has-archived flags are refreshed when the archive state or scope changed.
 */
export function applyUpdatedSurvey(queryClient: QueryClient, before: Survey, after: Survey): void {
  const from = scopeOf(before);
  const to = scopeOf(after);
  queryClient.setQueryData(surveyKeys.detail(after.id), after);
  patchCachedLists(queryClient, after.id, (project, archived) =>
    project === to && archived === after.archived ? after : undefined,
  );
  void queryClient.invalidateQueries({ queryKey: surveyKeys.listsOf(from) });
  if (to !== from) void queryClient.invalidateQueries({ queryKey: surveyKeys.listsOf(to) });
  if (before.archived !== after.archived || from !== to) {
    void queryClient.invalidateQueries({ queryKey: surveyKeys.hasArchived(from) });
    if (to !== from) {
      void queryClient.invalidateQueries({ queryKey: surveyKeys.hasArchived(to) });
    }
  }
}

/** Drops a deleted survey from the cache and refreshes its scope's lists and has-archived flag. */
export function removeDeletedSurvey(queryClient: QueryClient, survey: Survey): void {
  const scope = scopeOf(survey);
  queryClient.removeQueries({ queryKey: surveyKeys.detail(survey.id) });
  patchCachedLists(queryClient, survey.id, () => undefined);
  void queryClient.invalidateQueries({ queryKey: surveyKeys.listsOf(scope) });
  void queryClient.invalidateQueries({ queryKey: surveyKeys.hasArchived(scope) });
}

/** Renames, moves, archives, restores, publishes or changes settings: one merge patch. */
export function useUpdateSurvey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      survey,
      patch,
    }: {
      survey: Survey;
      patch: SurveyPatch;
    }): Promise<Survey> => {
      const { data, error, response } = await client.PATCH("/surveys/{surveyId}", {
        params: { path: { surveyId: survey.id } },
        body: patch,
        headers: { "Content-Type": "application/merge-patch+json" },
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data;
    },
    onSuccess: (updated, { survey }) => applyUpdatedSurvey(queryClient, survey, updated),
  });
}

/** Copies a survey into a new unpublished one in the source's scope. */
export function useCloneSurvey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (survey: Survey): Promise<Survey> => {
      const { data, error, response } = await client.POST("/surveys/{surveyId}/clones", {
        params: { path: { surveyId: survey.id } },
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data;
    },
    onSuccess: (copy) => addCreatedSurvey(queryClient, copy),
  });
}

/** Permanently deletes an archived survey. */
export function useDeleteSurvey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (survey: Survey): Promise<void> => {
      const { error, response } = await client.DELETE("/surveys/{surveyId}", {
        params: { path: { surveyId: survey.id } },
      });
      if (!response.ok) throw toApiError(error, response);
    },
    onSuccess: (_void, survey) => removeDeletedSurvey(queryClient, survey),
  });
}
