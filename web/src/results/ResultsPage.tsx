import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { definitionQueryOptions, type SurveyDefinition } from "../api/content";
import { allResultsQueryOptions, type SurveyResponse } from "../api/results";
import { surveyQueryOptions } from "../api/surveys";
import {
  resetResultsView,
  resultsViewQueryOptions,
  type ViewName,
  type ViewState,
} from "../api/views";
import { surveyListSearch } from "../surveyList/search";
import { PlaceholderFrame } from "../surveyList/surveyPlaceholder";
import { useLicenceApplied } from "../surveyjs/useLicenceApplied";
import { DetailsTab } from "./DetailsTab";
import styles from "./results.module.css";
import { resultsSearch, type ResultsTab } from "./search";
import { useViewSaver } from "./useViewSaver";

/** What the Summary and the Table get from the page. */
export interface ResultsWidgetProps {
  readonly surveyId: string;
  readonly definition: SurveyDefinition;
  /** Every response, oldest first. */
  readonly responses: readonly SurveyResponse[];
  /** The state when the widget mounts (later changes of the prop are ignored); null = default layout. */
  readonly savedState: ViewState | null;
  /** Each state the user makes; the page saves it (debounced). */
  readonly onStateChange: (state: ViewState) => void;
}

// The Dashboard and the table load only here, each on demand: nothing the survey list or this
// page's own chunk imports pulls them in, and the table's code waits for the Table tab.
const SummaryView = lazy(async () => ({ default: (await import("./SummaryView")).SummaryView }));
const TableView = lazy(async () => ({ default: (await import("./TableView")).TableView }));

const rootRoute = getRouteApi("__root__");

// surveyjs.io's tab labels and order (D14).
const TABS: readonly { tab: ResultsTab; label: string }[] = [
  { tab: "summary", label: "Summary" },
  { tab: "table", label: "Table" },
  { tab: "details", label: "Details" },
];

const LOADING = (
  <p className="v2-class---paragraph" role="status">
    Loading results…
  </p>
);
const SAVE_FAILED_TEXT = "Your layout could not be saved. It is saved again with your next change.";

/**
 * The results of one survey (`/surveys/$surveyId/results?tab=`): the Summary charts, the Table and
 * the Details tab. Every response, the definition and both saved layouts are read once per visit
 * and kept while the page is open, so switching tabs reads nothing again. Layout changes are
 * saved per user, debounced; leaving a tab sends a waiting change at once.
 */
export function ResultsPage({ surveyId, tab }: { surveyId: string; tab: ResultsTab }) {
  const queryClient = useQueryClient();
  const { data: survey } = useSuspenseQuery(surveyQueryOptions(surveyId));
  const config = rootRoute.useLoaderData();
  const licenceApplied = useLicenceApplied(config.surveyjsLicenseKey ?? null);
  const results = useQuery(allResultsQueryOptions(surveyId));
  const definition = useQuery(definitionQueryOptions(surveyId));
  const summaryView = useQuery(resultsViewQueryOptions(surveyId, "summary"));
  const tableView = useQuery(resultsViewQueryOptions(surveyId, "table"));
  const summarySaver = useViewSaver(surveyId, "summary");
  const tableSaver = useViewSaver(surveyId, "table");
  const saverOf = (view: ViewName) => (view === "summary" ? summarySaver : tableSaver);

  // Leaving a tab sends what its widget still holds for the debounce delay.
  const { flush: flushSummary } = summarySaver;
  const { flush: flushTable } = tableSaver;
  useEffect(
    () => () => {
      void flushSummary();
      void flushTable();
    },
    [tab, flushSummary, flushTable],
  );

  const stateChange = (view: ViewName) => (state: ViewState) => {
    // A widget mounted again after a tab switch starts from the latest layout, without a read.
    queryClient.setQueryData(resultsViewQueryOptions(surveyId, view).queryKey, state);
    saverOf(view).change(state);
  };

  const reset = async (view: ViewName) => {
    const { queryKey } = resultsViewQueryOptions(surveyId, view);
    // A save still in flight would bring the layout back after the reset.
    await saverOf(view).cancel();
    await resetResultsView(surveyId, view);
    // A read still in flight would bring the old layout back.
    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData(queryKey, null);
  };

  let content: ReactNode;
  if (tab === "details") {
    content = <DetailsTab onReset={reset} />;
  } else {
    const view = tab === "summary" ? summaryView : tableView;
    // Only first reads that failed and are not being retried.
    const failed = [results, definition, view].filter(
      (query) => query.isError && query.data === undefined && query.fetchStatus === "idle",
    );
    if (failed.length > 0) {
      content = (
        <div role="alert">
          <p className="v2-class---paragraph">
            The results could not be loaded. Check your connection and try again.
          </p>
          <button type="button" onClick={() => failed.forEach((query) => void query.refetch())}>
            Try again
          </button>
        </div>
      );
    } else if (
      results.data === undefined ||
      definition.data === undefined ||
      view.data === undefined ||
      !licenceApplied
    ) {
      content = LOADING;
    } else {
      const props: ResultsWidgetProps = {
        surveyId,
        definition: definition.data.content,
        responses: results.data,
        savedState: view.data,
        onStateChange: stateChange(tab),
      };
      content = (
        <Suspense fallback={LOADING}>
          {tab === "summary" ? <SummaryView {...props} /> : <TableView {...props} />}
        </Suspense>
      );
    }
  }

  const back = surveyListSearch({
    project: survey.projectId ?? "personal",
    archived: survey.archived,
  });
  return (
    <PlaceholderFrame title={survey.name}>
      <div className="tabs survey-results-page__tabs">
        <ul className={`tabs__wrapper my-surveys-page__tabs-wrapper ${styles.tabs}`}>
          {TABS.map(({ tab: target, label }) => {
            const active = target === tab;
            return (
              <li key={target} className="tabs__tab-wrapper">
                <Link
                  className={
                    active
                      ? "tabs__tab tabs__tab--active my-surveys-page__tabs-tab-active"
                      : "tabs__tab"
                  }
                  to="/surveys/$surveyId/results"
                  params={{ surveyId }}
                  search={resultsSearch(target)}
                  // The page marks the active tab itself: the router would also count the
                  // Summary link (no search) as active on the other tabs.
                  activeOptions={{ exact: true }}
                  activeProps={{}}
                  aria-current={active ? "page" : undefined}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className={`tabs__tab-content survey-results-page__tab-content ${styles.tabContent}`}>
          {content}
        </div>
      </div>
      <div role="status">
        {(summarySaver.failed || tableSaver.failed) && (
          <p className="v2-class---paragraph">{SAVE_FAILED_TEXT}</p>
        )}
      </div>
      <p className="v2-class---paragraph">
        <Link className="v2-class---paragraph-link" to="/" search={back}>
          Back to My Surveys
        </Link>
      </p>
    </PlaceholderFrame>
  );
}
