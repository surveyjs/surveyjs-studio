import { queryOptions } from "@tanstack/react-query";
import type { components } from "@my-surveys/contract/types";
import { client, toApiError } from "./client";
import { freshReadOnce } from "./content";

export type SurveyResponse = components["schemas"]["SurveyResponse"];
export type ResponsePage = components["schemas"]["ResponsePage"];

/** The largest page the server allows. */
export const RESULTS_PAGE_SIZE = 1000;

export const resultKeys = {
  all: (surveyId: string) => ["results", surveyId.toLowerCase()] as const,
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
