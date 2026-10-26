import { queryOptions } from "@tanstack/react-query";
import type { components } from "@surveyjs-studio/contract/types";
import { client, toApiError } from "./client";
import { freshReadOnce } from "./content";

export type ViewName = "summary" | "table";
export type ViewState = components["schemas"]["ViewState"];

export const viewKeys = {
  view: (surveyId: string, view: ViewName) => ["views", surveyId.toLowerCase(), view] as const,
};

/** The user's saved layout, or null when there is none (`view-not-found`). */
export async function getResultsView(
  surveyId: string,
  view: ViewName,
  signal?: AbortSignal,
): Promise<ViewState | null> {
  const { data, error, response } = await client.GET("/surveys/{surveyId}/views/{view}", {
    params: { path: { surveyId, view } },
    signal,
  });
  if (
    response.status === 404 &&
    (error as { code?: unknown } | undefined)?.code === "view-not-found"
  ) {
    return null;
  }
  if (!response.ok || data === undefined) throw toApiError(error, response);
  return data;
}

/**
 * Below this many UTF-8 bytes a save is sent with `keepalive`, so one started on `pagehide`
 * survives the page. Browsers cap a keepalive body at 64 KiB of bytes (not characters), and a
 * fetch over the cap rejects, so the size is measured in bytes.
 */
const KEEPALIVE_LIMIT_BYTES = 60_000;

export async function saveResultsView(
  surveyId: string,
  view: ViewName,
  state: ViewState,
): Promise<void> {
  const json = JSON.stringify(state);
  const { error, response } = await client.PUT("/surveys/{surveyId}/views/{view}", {
    params: { path: { surveyId, view } },
    body: state,
    bodySerializer: () => json,
    keepalive: new TextEncoder().encode(json).length < KEEPALIVE_LIMIT_BYTES,
  });
  if (!response.ok) throw toApiError(error, response);
}

export async function resetResultsView(surveyId: string, view: ViewName): Promise<void> {
  const { error, response } = await client.DELETE("/surveys/{surveyId}/views/{view}", {
    params: { path: { surveyId, view } },
  });
  if (!response.ok) throw toApiError(error, response);
}

export const resultsViewQueryOptions = (surveyId: string, view: ViewName) =>
  queryOptions({
    queryKey: viewKeys.view(surveyId, view),
    ...freshReadOnce,
    queryFn: ({ signal }) => getResultsView(surveyId, view, signal),
  });
