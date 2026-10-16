import { useInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { historyInfiniteQueryOptions } from "../api/content";
import { surveyQueryOptions } from "../api/surveys";
import clockIcon from "../shell/surveyjs-site/assets/site/Content/Images/Clock_12x12.svg";
import { formatHistoryTime } from "../surveyList/formatDate";
import { surveyListSearch } from "../surveyList/search";
import { PlaceholderFrame } from "../surveyList/surveyPlaceholder";
import styles from "./history.module.css";

const linkButton = `v2-class---paragraph-link ${styles.linkButton}`;

/** The edits of one survey, newest first, with the user when known (US 57). */
export function HistoryPage({ surveyId }: { surveyId: string }) {
  const { data: survey } = useSuspenseQuery(surveyQueryOptions(surveyId));
  const history = useInfiniteQuery(historyInfiniteQueryOptions(surveyId));
  const back = surveyListSearch({
    project: survey.projectId ?? "personal",
    archived: survey.archived,
  });
  const entries = history.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <PlaceholderFrame title={`Survey editing history of the '${survey.name}'`}>
      {history.data === undefined && history.isError ? (
        <p className="v2-class---paragraph" role="alert">
          Could not load the history. Please try again.{" "}
          <button type="button" className={linkButton} onClick={() => void history.refetch()}>
            Try again
          </button>
        </p>
      ) : history.isPending ? (
        <p className="v2-class---paragraph">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="v2-class---paragraph">No edits yet.</p>
      ) : (
        <ul className={styles.list}>
          {entries.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="my-surveys-history-item">
              <img className="my-surveys-page__clock-icon" src={clockIcon} alt="" />{" "}
              <time dateTime={entry.at}>{formatHistoryTime(entry.at)}</time>
              {entry.user ? ` by ${entry.user.displayName}` : null}
            </li>
          ))}
        </ul>
      )}
      {history.isFetchNextPageError ? (
        <p className="v2-class---paragraph" role="alert">
          Could not load more entries. Please try again.
        </p>
      ) : null}
      {history.hasNextPage ? (
        <p className="v2-class---paragraph">
          <button
            type="button"
            className={linkButton}
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            Show more
          </button>
        </p>
      ) : null}
      <p className="v2-class---paragraph">
        <Link className="v2-class---paragraph-link" to="/" search={back}>
          Back to My Surveys
        </Link>
      </p>
    </PlaceholderFrame>
  );
}
