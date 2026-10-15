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
