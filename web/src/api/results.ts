import { queryOptions, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { components } from "@surveyjs-studio/contract/types";
import { client, toApiError } from "./client";
import { freshReadOnce } from "./content";

export type SurveyResponse = components["schemas"]["SurveyResponse"];
export type ResponsePage = components["schemas"]["ResponsePage"];
export type ResultStats = components["schemas"]["ResultStats"];

/** The largest page the server allows. */
export const RESULTS_PAGE_SIZE = 1000;

export const resultKeys = {
  all: (surveyId: string) => ["results", surveyId.toLowerCase()] as const,
  /** Not under the `["results", id]` prefix: a setting change must not touch it, nor the reverse. */
  stats: (surveyId: string) => ["result-stats", surveyId.toLowerCase()] as const,
};

/** Every response of the survey, oldest first: pages of 1000 until the server sends no cursor. */
export async function loadAllResults(
  surveyId: string,
  signal?: AbortSignal,
): Promise<SurveyResponse[]> {
  const responses: SurveyResponse[] = [];
  let cursor: string | undefined;
  for (;;) {
    const { data, error, response } = await client.GET("/surveys/{surveyId}/results", {
      params: { path: { surveyId }, query: { limit: RESULTS_PAGE_SIZE, cursor } },
      signal,
    });
    if (!response.ok || data === undefined) throw toApiError(error, response);
    responses.push(...data.items);
    if (data.nextCursor === null) return responses;
    if (data.nextCursor === cursor) throw new Error("The server sent the same cursor twice.");
    cursor = data.nextCursor;
  }
}

export const allResultsQueryOptions = (surveyId: string) =>
  queryOptions({
    queryKey: resultKeys.all(surveyId),
    ...freshReadOnce,
    queryFn: ({ signal }) => loadAllResults(surveyId, signal),
  });

/** The response count and the first and last response times (Details tab). */
export const resultStatsQueryOptions = (surveyId: string) =>
  queryOptions({
    queryKey: resultKeys.stats(surveyId),
    queryFn: async ({ signal }): Promise<ResultStats> => {
      const { data, error, response } = await client.GET("/surveys/{surveyId}/results/stats", {
        params: { path: { surveyId } },
        signal,
      });
      if (!response.ok || data === undefined) throw toApiError(error, response);
      return data;
    },
  });

/** Deletes every response of the survey (`204`); rejects with `ApiError` (`forbidden`, ...). */
export async function deleteResults(surveyId: string): Promise<void> {
  const { error, response } = await client.DELETE("/surveys/{surveyId}/results", {
    params: { path: { surveyId } },
  });
  if (!response.ok) throw toApiError(error, response);
}

/** After a deletion: the cached responses are empty and the statistics are read again. */
export async function applyDeletedResults(
  queryClient: QueryClient,
  surveyId: string,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: resultKeys.all(surveyId) });
  queryClient.setQueryData(resultKeys.all(surveyId), []);
  await queryClient.invalidateQueries({ queryKey: resultKeys.stats(surveyId) });
}

export function useDeleteResults() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteResults,
    onSuccess: (_void, surveyId) => applyDeletedResults(queryClient, surveyId),
  });
}
