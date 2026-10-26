// The respondent's endpoints (`/public/surveys/…`): no session, used by the run page.
import { queryOptions } from "@tanstack/react-query";
import type { components } from "@surveyjs-studio/contract/types";
import { client, toApiError } from "./client";
import type { StoredFile } from "./files";
import { RESULTS_PAGE_SIZE } from "./results";

export type PublishedSurvey = components["schemas"]["PublishedSurvey"];
export type PublicResultPage = components["schemas"]["PublicResultPage"];
type ResponseSubmission = components["schemas"]["ResponseSubmission"];

/** A response as the run page sends it (`partial` and `lastPageIndex` are Phase 1 and unused). */
export interface ResponseBody {
  readonly data: Record<string, unknown>;
  readonly clientId?: string;
}

/**
 * Reads a published survey (`GET /public/surveys/{id}`). `clientId` goes in the query only when
 * given; the answer's `completed` then tells whether that client has completed the survey.
 * Rejects with `ApiError` (`survey-not-available` for an unknown or unpublished survey).
 */
export async function getPublishedSurvey(
  surveyId: string,
  clientId?: string,
  signal?: AbortSignal,
): Promise<PublishedSurvey> {
  const { data, error, response } = await client.GET("/public/surveys/{surveyId}", {
    params: { path: { surveyId }, ...(clientId !== undefined && { query: { clientId } }) },
    signal,
  });
  if (!response.ok || data === undefined) throw toApiError(error, response);
  return data;
}

/**
 * Stores a response (`POST /public/surveys/{id}/responses`). The same `idempotencyKey` for the
 * same survey stores nothing more and answers the first response's id. Rejects with `ApiError`
 * (`already-completed`, `payload-too-large`, `rate-limited`, …).
 */
export async function submitResponse(
  surveyId: string,
  body: ResponseBody,
  idempotencyKey: string,
): Promise<{ id: string }> {
  const { data, error, response } = await client.POST("/public/surveys/{surveyId}/responses", {
    params: { path: { surveyId }, header: { "Idempotency-Key": idempotencyKey } },
    // `partial` has a default in the contract, which the generated type lists as required.
    body: body as ResponseSubmission,
  });
  if (!response.ok || data === undefined) throw toApiError(error, response);
  return data;
}

/**
 * Uploads a respondent's file (`POST /public/surveys/{id}/files`, multipart part `file` with the
 * file's name). Resolves to the stored file, whose `url` goes into the answers; rejects with
 * `ApiError` (`payload-too-large`, `rate-limited`, …).
 */
export async function uploadResponseFile(surveyId: string, file: File): Promise<StoredFile> {
  const { data, error, response } = await client.POST("/public/surveys/{surveyId}/files", {
    params: { path: { surveyId } },
    // As `uploadSurveyAsset` (./files.ts): the File stands in for the contract's binary string.
    body: { file: file as unknown as string },
    bodySerializer: () => {
      const form = new FormData();
      form.append("file", file, file.name);
      return form;
    },
  });
  if (!response.ok || data === undefined) throw toApiError(error, response);
  return data;
}

/** Every response of a survey with public results, and the survey (from the first page). */
export interface PublicResults {
  readonly survey: PublicResultPage["survey"];
  readonly items: PublicResultPage["items"];
}

export const publicResultKeys = {
  all: (surveyId: string) => ["public-results", surveyId.toLowerCase()] as const,
};

/**
 * Reads the public results page after page (`GET /public/surveys/{id}/results`, 1000 each) until the
 * server sends no cursor. Rejects with `ApiError` (`404 survey-not-available` while Grant Access is off).
 */
export async function loadPublicResults(
  surveyId: string,
  signal?: AbortSignal,
): Promise<PublicResults> {
  const items: PublicResultPage["items"] = [];
  let survey: PublicResultPage["survey"] | undefined;
  let cursor: string | undefined;
  for (;;) {
    const { data, error, response } = await client.GET("/public/surveys/{surveyId}/results", {
      params: { path: { surveyId }, query: { limit: RESULTS_PAGE_SIZE, cursor } },
      signal,
    });
    if (!response.ok || data === undefined) throw toApiError(error, response);
    survey ??= data.survey;
    items.push(...data.items);
    if (data.nextCursor === null) return { survey, items };
    if (data.nextCursor === cursor) throw new Error("The server sent the same cursor twice.");
    cursor = data.nextCursor;
  }
}

/** Loaded once per page visit: a public page does not refresh behind the reader. */
export const publicResultsQueryOptions = (surveyId: string) =>
  queryOptions({
    queryKey: publicResultKeys.all(surveyId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) => loadPublicResults(surveyId, signal),
  });
