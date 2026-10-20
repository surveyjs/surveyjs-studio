import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { publicResultsQueryOptions } from "../api/public";
import { useLicenceApplied } from "../surveyjs/useLicenceApplied";
import "../shell/surveyjs-site/assets/surveyjs-site.scss";
import "./public-results.css";
import { publicResultsState } from "./publicResultsState";
import type { ResultsWidgetProps } from "./ResultsPage";

// The Dashboard and the table load only here, each on demand (see ResultsPage).
const SummaryView = lazy(async () => ({ default: (await import("./SummaryView")).SummaryView }));
const TableView = lazy(async () => ({ default: (await import("./TableView")).TableView }));

const rootRoute = getRouteApi("__root__");

type PublicTab = "summary" | "table";

// surveyjs.io's tab labels and order (D14), without Details.
const TABS: readonly { tab: PublicTab; label: string }[] = [
  { tab: "summary", label: "Summary" },
  { tab: "table", label: "Table" },
];

const LOADING = (
  <p className="v2-class---paragraph" role="status">
    Loading the results…
  </p>
);

/**
 * The public results page of a survey with Grant Access on (`/results/$surveyId`), without the
 * site's shell: the Summary and the Table, read only, private questions left out. The results
 * are read once per open.
 */
export function PublicResultsPage({ surveyId }: { surveyId: string }) {
  const query = useQuery(publicResultsQueryOptions(surveyId));
  const config = rootRoute.useLoaderData();
  const licenceApplied = useLicenceApplied(config.surveyjsLicenseKey ?? null);
  const [tab, setTab] = useState<PublicTab>("summary");
  // "Try again" after a failure shows the loading state while it reads.
  const state = publicResultsState({
    status: query.isError && query.isFetching ? "pending" : query.status,
    error: query.error,
    data: query.data,
  });
  const name = state.kind === "ready" ? state.data.survey.name : null;

  useEffect(() => {
    if (state.kind === "unavailable") document.title = "Results not available";
    else if (name !== null) document.title = name.trim() === "" ? "Results" : name;
  }, [state.kind, name]);

  switch (state.kind) {
    case "loading":
      return <main className="public-results">{LOADING}</main>;
    case "unavailable":
      return (
        <main className="public-results">
          <h3 className="public-results__not-available">These survey results are not available.</h3>
        </main>
      );
    case "failed":
      return (
        <main className="public-results">
          <div role="alert">
            <p>The results could not be loaded. Check your connection and try again.</p>
            <button type="button" onClick={() => void query.refetch()}>
              Try again
            </button>
          </div>
        </main>
      );
    case "ready": {
      const { survey, items } = state.data;
      const props: ResultsWidgetProps = {
        surveyId,
        definition: survey.definition,
        responses: items,
        savedState: null,
        privateQuestions: survey.privateQuestions ?? [],
        publicView: true,
      };
      return (
        <main>
          <div className="survey-results-page">
            <h3 className="survey-results-page__title">My Surveys. Results</h3>
            <h1 className="survey-results-page__description">{survey.name}</h1>
            <div className="tabs survey-results-page__tabs">
              <ul className="tabs__wrapper my-surveys-page__tabs-wrapper">
                {TABS.map(({ tab: target, label }) => {
                  const active = target === tab;
                  return (
                    <li key={target} className="tabs__tab-wrapper">
                      <a
                        className={
                          active
                            ? "tabs__tab tabs__tab--active my-surveys-page__tabs-tab-active"
                            : "tabs__tab"
                        }
                        href={`#${target}`}
                        aria-current={active ? "page" : undefined}
                        onClick={(event) => {
                          event.preventDefault();
                          setTab(target);
                        }}
                      >
                        {label}
                      </a>
                    </li>
                  );
                })}
              </ul>
              <div
                id={tab === "summary" ? "summaryContainer" : undefined}
                className="tabs__tab-content survey-results-page__tab-content"
              >
                {licenceApplied ? (
                  <Suspense fallback={LOADING}>
                    {tab === "summary" ? <SummaryView {...props} /> : <TableView {...props} />}
                  </Suspense>
                ) : (
                  LOADING
                )}
              </div>
            </div>
          </div>
        </main>
      );
    }
  }
}
