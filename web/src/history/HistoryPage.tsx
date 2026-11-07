import { useInfiniteQuery, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import {
  historyEntryQueryOptions,
  historyInfiniteQueryOptions,
  type HistoryPage as HistoryPageData,
} from "../api/content";
import { surveyQueryOptions } from "../api/surveys";
import clockIcon from "../shell/surveyjs-site/assets/site/Content/Images/Clock_12x12.svg";
import { Icon } from "../shell/surveyjs-site/SiteIcon";
import { formatHistoryTime } from "../surveyList/formatDate";
import { surveyListSearch } from "../surveyList/search";
import { CLIPBOARD_ERROR } from "../surveyList/useSurveyActions";
import styles from "./history.module.css";

type HistoryEntry = HistoryPageData["items"][number];

/** How long "Copied" replaces "Copy JSON" after a copy. */
const COPIED_FOR_MS = 2000;

const linkButton = `v2-class---paragraph-link ${styles.linkButton}`;

/**
 * The edits of one survey, newest first, with the user when known (US 57). The frame, heading and
 * entries are the site's History page (`the site's page markup`).
 */
export function HistoryPage({ surveyId }: { surveyId: string }) {
  const { data: survey } = useSuspenseQuery(surveyQueryOptions(surveyId));
  const history = useInfiniteQuery(historyInfiniteQueryOptions(surveyId));
  const back = surveyListSearch({
    project: survey.projectId ?? "personal",
    archived: survey.archived,
  });
  const entries = history.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="my-surveys-page__results-section">
      <div className="mod-pt-40">
        <div className="my-surveys-page__header-content">
          <h1 className="title my-surveys-page__title">
            Survey editing history of the &apos;{survey.name}&apos;
          </h1>
        </div>
      </div>
      <div className="mod-mt-50 mod-mb-50">
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
              <HistoryItem key={`${entry.id}-${index}`} surveyId={surveyId} entry={entry} />
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
      </div>
      <p className="v2-class---paragraph">
        <Link className="v2-class---paragraph-link" to="/" search={back}>
          Back to My Surveys
        </Link>
      </p>
    </section>
  );
}

/**
 * One entry: its time (and user) toggles the JSON saved in it, read when first opened, with Copy
 * JSON above it (the site's `loadItem` and `copyJSON`).
 */
function HistoryItem({ surveyId, entry }: { surveyId: string; entry: HistoryEntry }) {
  const [open, setOpen] = useState(false);
  const jsonId = useId();
  return (
    <li className="my-surveys-history-item">
      <div>
        <button
          type="button"
          className={`action-link ${styles.toggle}`}
          aria-expanded={open}
          aria-controls={jsonId}
          onClick={() => setOpen((value) => !value)}
        >
          <img className="my-surveys-page__clock-icon" src={clockIcon} alt="" />{" "}
          <time dateTime={entry.at}>{formatHistoryTime(entry.at)}</time>
          {entry.user ? (
            <span className="my-surveys-history-item__user">{` by ${entry.user.displayName}`}</span>
          ) : null}
        </button>
      </div>
      {open ? <EntryJson id={jsonId} surveyId={surveyId} entryId={entry.id} /> : null}
    </li>
  );
}

/** The JSON of an open entry; mounted on each open, so a failed read is tried again. */
function EntryJson({ id, surveyId, entryId }: { id: string; surveyId: string; entryId: string }) {
  const entry = useQuery(historyEntryQueryOptions(surveyId, entryId));
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  if (entry.isError) {
    return (
      <p id={id} className="v2-class---paragraph" role="alert">
        Could not load this version. Please try again.
      </p>
    );
  }
  if (entry.data === undefined) {
    return (
      <p id={id} className="v2-class---paragraph">
        Loading…
      </p>
    );
  }
  const text = JSON.stringify(entry.data, null, 2);
  const copy = () => {
    setCopyFailed(false);
    let writing: Promise<void>;
    try {
      writing = navigator.clipboard.writeText(text);
    } catch (failure) {
      // No clipboard API (an insecure context).
      writing = Promise.reject(failure instanceof Error ? failure : new Error(String(failure)));
    }
    writing.then(
      () => setCopied(true),
      () => setCopyFailed(true),
    );
  };
  const label = copied ? "Copied" : "Copy JSON";

  return (
    <div id={id} className={styles.json}>
      <button
        type="button"
        className="v2-class---footer-toolbar-item v2-class---footer-toolbar-item--button"
        title={label}
        onClick={copy}
      >
        <span className="v2-class---footer-toolbar-item__icon v2-class---footer-toolbar-item__icon--normal">
          <Icon name="24x24/Copy-Code" type="Primary" size="Smedium" />
        </span>
        <span className="v2-class---footer-toolbar-item__icon v2-class---footer-toolbar-item__icon--small">
          <Icon name="20x20/Copy-Code" type="Primary" size="SSmedium" />
        </span>
        <span className="v2-class---footer-toolbar-item__text">{label}</span>
      </button>
      {copyFailed ? (
        <p className="v2-class---paragraph" role="alert">
          {CLIPBOARD_ERROR}
        </p>
      ) : null}
      <div className="svc-custom-embedded-tab__code-container" style={{ userSelect: "text" }}>
        <pre className="source-code source-code-embed language-json" tabIndex={-1}>
          <code className="content-js language-javascript">{text}</code>
        </pre>
      </div>
    </div>
  );
}
