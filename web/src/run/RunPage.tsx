import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createClientIds } from "./clientId";
import { loadRunSurvey } from "./load";
import { NotAvailable } from "./NotAvailable";
import "./run-page.css";
import { RunSurvey, type RunBrandInfo } from "./RunSurvey";
import { runPageState } from "./runState";
import type { RunSearch } from "./search";

const rootRoute = getRouteApi("__root__");

/**
 * The public run page of a published survey (`/s/$surveyId`), without the site's shell, as
 * surveyjs.io's run page (whose `/published?id=` links the site redirects here). The survey is
 * read once per open: answering it must not be interrupted by a refetch.
 */
export function RunPage({
  surveyId,
  search,
  brandInfo,
}: {
  surveyId: string;
  search: RunSearch;
  /** The brand block under the survey. */
  brandInfo: RunBrandInfo;
}) {
  // The route mounts one page per survey (`key`), so one per mount is one per survey.
  const [clientIds] = useState(() => createClientIds(surveyId));
  const { limits } = rootRoute.useLoaderData();
  const query = useQuery({
    queryKey: ["public-survey", surveyId],
    queryFn: ({ signal }) => loadRunSurvey(surveyId, clientIds, signal),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  // "Try again" after a failure shows the loading state while it reads.
  const state = runPageState({
    status: query.isError && query.isFetching ? "pending" : query.status,
    error: query.error,
    data: query.data,
  });
  const name =
    state.kind === "running" || state.kind === "completed" ? state.data.survey.name : null;

  useEffect(() => {
    if (name !== null) document.title = name.trim() === "" ? "Survey" : name;
  }, [name]);

  switch (state.kind) {
    case "unavailable":
      return <NotAvailable />;
    case "loading":
      return (
        <main className="running-survey">
          <p role="status">Loading the survey…</p>
        </main>
      );
    case "failed":
      return (
        <main className="running-survey">
          <div role="alert">
            <p>The survey could not be loaded. Check your connection and try again.</p>
            <button type="button" onClick={() => void query.refetch()}>
              Try again
            </button>
          </div>
        </main>
      );
    case "running":
    case "completed":
      return (
        <main className="running-survey">
          <RunSurvey
            surveyId={surveyId}
            data={state.data}
            kind={state.kind}
            search={search}
            clientIds={clientIds}
            maxFileBytes={limits.maxFileBytes}
            brandInfo={brandInfo}
          />
        </main>
      );
  }
}
