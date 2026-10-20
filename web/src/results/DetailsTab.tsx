import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { API_BASE_URL } from "../api/client";
import { resultStatsQueryOptions, useDeleteResults } from "../api/results";
import { useUpdateSurvey, type Survey } from "../api/surveys";
import type { ViewName } from "../api/views";
import { deleteConfirmed, responseTime, settingToggle, type DetailsSetting } from "./details";
import { exportResultsUrl, publicResultsUrl } from "./downloadUrl";

// surveyjs.io's confirm question before Delete Results (D14).
const DELETE_CONFIRM = "Are you absolutely sure that you want to delete all results ?";

// The texts, classes and confirm questions of surveyjs.io's two Reset sections (D14).
const SECTIONS: readonly {
  view: ViewName;
  text: string;
  button: string;
  confirm: string;
  done: string;
}[] = [
  {
    view: "table",
    text: "Your custom survey data table will be reset to its default state. Please be aware that the table state reset is irreversible.",
    button: "Reset Table State",
    confirm: "Are you absolutely sure that you want to remove table state ?",
    done: "The table layout is reset.",
  },
  {
    view: "summary",
    text: "Your custom survey data summary will be reset to its default state. Please be aware that the summary state reset is irreversible.",
    button: "Reset Summary State",
    confirm: "Are you absolutely sure that you want to remove summary state ?",
    done: "The summary layout is reset.",
  },
];

const FAILED_TEXT = "The layout was not reset. Please try again.";

/**
 * The Details tab: the totals and dates, the downloads, and for callers who may modify the survey
 * the Grant Access and Save Respondent IP toggles and Delete Results; the two Reset sections show
 * for everyone (`onReset` removes the user's saved layout of that view).
 */
export function DetailsTab({
  survey,
  onReset,
}: {
  survey: Survey;
  onReset: (view: ViewName) => Promise<void>;
}) {
  const stats = useQuery(resultStatsQueryOptions(survey.id));
  const canModify = survey.permissions.canModify;
  const count = stats.data?.count;

  let totals;
  if (stats.data !== undefined) {
    const { firstSubmittedAt, lastSubmittedAt } = stats.data;
    totals = (
      <>
        <div className="survey-results-header-line">
          <span>Total responses:</span> <span>{stats.data.count}</span>
        </div>
        {stats.data.count > 0 && firstSubmittedAt !== null && lastSubmittedAt !== null && (
          <>
            <div className="survey-results-header-line">
              <span>First response at:</span> <span>{responseTime(firstSubmittedAt)}</span>
            </div>
            <div className="survey-results-header-line">
              <span>Last response at:</span> <span>{responseTime(lastSubmittedAt)}</span>
            </div>
          </>
        )}
      </>
    );
  } else if (stats.isError && stats.fetchStatus === "idle") {
    totals = (
      <div role="alert">
        <p className="v2-class---paragraph">
          The statistics could not be loaded. Check your connection and try again.
        </p>
        <button type="button" onClick={() => void stats.refetch()}>
          Try again
        </button>
      </div>
    );
  } else {
    totals = (
      <p className="v2-class---paragraph" role="status">
        Loading statistics…
      </p>
    );
  }

  return (
    <div className="column-layout">
      <div className="column-layout__column survey-results-header-left">
        {totals}
        <div className="survey-results-header-line mod-mt-30">
          <span>Download all results as:</span>
        </div>
        <div className="mod-mt-20">
          <a
            className="rounded-button"
            href={exportResultsUrl(API_BASE_URL, survey.id, "json")}
            download
          >
            JSON
          </a>
        </div>
        <div className="mod-mt-20">
          <a
            className="rounded-button"
            href={exportResultsUrl(API_BASE_URL, survey.id, "csv")}
            download
          >
            CSV
          </a>
        </div>
      </div>
      <div className="column-layout__column column-layout__column--float-right survey-results-header-right">
        {canModify && (
          <>
            <SettingToggle survey={survey} setting="publicResults" />
            <SettingToggle survey={survey} setting="storeRespondentIp" />
            <DeleteResults survey={survey} hasResults={count !== undefined && count > 0} />
          </>
        )}
        {SECTIONS.map((section) => (
          <ResetSection key={section.view} {...section} onReset={onReset} />
        ))}
      </div>
    </div>
  );
}

/** One on/off setting: not optimistic, the button waits while the change is saved. */
function SettingToggle({ survey, setting }: { survey: Survey; setting: DetailsSetting }) {
  const update = useUpdateSurvey();
  const [failed, setFailed] = useState(false);
  const on = survey.settings[setting] === true;
  const { text, button, patch } = settingToggle(setting, on);
  const isAccess = setting === "publicResults";

  const toggle = async () => {
    setFailed(false);
    try {
      await update.mutateAsync({ survey, patch });
    } catch {
      setFailed(true);
    }
  };

  return (
    <div id={isAccess ? "resultaccess" : "resultstoreIP"} className="survey-results-header-line">
      <div>
        {text}{" "}
        {isAccess && on && (
          <>
            <a
              className="action-link"
              href={publicResultsUrl(window.location.origin, survey.id)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Go to the results page
            </a>{" "}
          </>
        )}
        <button
          className={isAccess ? "rounded-button" : "rounded-button btn-sm"}
          type="button"
          disabled={update.isPending}
          onClick={() => void toggle()}
        >
          <span>{button}</span>
        </button>
      </div>
      {failed && (
        <p className="v2-class---paragraph" role="alert">
          The setting could not be saved. Please try again.
        </p>
      )}
    </div>
  );
}

/** Delete Results in two steps: the survey name, then a confirm. The outcome outlives the section. */
function DeleteResults({ survey, hasResults }: { survey: Survey; hasResults: boolean }) {
  const deletion = useDeleteResults();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [outcome, setOutcome] = useState<"idle" | "done" | "failed">("idle");

  const clear = async () => {
    if (!window.confirm(DELETE_CONFIRM)) return;
    setOutcome("idle");
    try {
      await deletion.mutateAsync(survey.id);
      setOutcome("done");
      setOpen(false);
      setTyped("");
    } catch {
      setOutcome("failed");
    }
  };

  return (
    <div className="mod-mt-30">
      {hasResults && (
        <>
          <button
            className="rounded-button rounded-button--danger"
            type="button"
            onClick={() => setOpen(!open)}
          >
            Delete Results
          </button>
          {/* Always laid out, as on the site, so the sections below keep their place. */}
          <div id="ctrlClearAll" style={{ visibility: open ? "visible" : "hidden" }}>
            <div>
              <div>Deletes all survey results without the possibility to restore.</div>
              <div>
                <input
                  type="text"
                  placeholder="Type the survey name"
                  aria-label="Type the survey name"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                />
                <span>
                  <button
                    type="button"
                    disabled={!deleteConfirmed(typed, survey.name) || deletion.isPending}
                    onClick={() => void clear()}
                  >
                    Clear All Data
                  </button>
                </span>
              </div>
            </div>
          </div>
        </>
      )}
      {outcome === "done" && (
        <p className="v2-class---paragraph" role="status">
          All results are deleted.
        </p>
      )}
      {outcome === "failed" && (
        <p className="v2-class---paragraph" role="alert">
          The results could not be deleted. Please try again.
        </p>
      )}
    </div>
  );
}

function ResetSection({
  view,
  text,
  button,
  confirm,
  done,
  onReset,
}: (typeof SECTIONS)[number] & { onReset: (view: ViewName) => Promise<void> }) {
  const [outcome, setOutcome] = useState<"idle" | "resetting" | "done" | "failed">("idle");

  const reset = async () => {
    if (!window.confirm(confirm)) return;
    setOutcome("resetting");
    try {
      await onReset(view);
      setOutcome("done");
    } catch {
      setOutcome("failed");
    }
  };

  return (
    <div className="mod-mt-30">
      <div>{text}</div>
      <div>
        <span>
          <button
            className="rounded-button rounded-button--danger"
            type="button"
            disabled={outcome === "resetting"}
            onClick={() => void reset()}
          >
            {button}
          </button>
        </span>
      </div>
      {outcome === "done" && (
        <p className="v2-class---paragraph" role="status">
          {done}
        </p>
      )}
      {outcome === "failed" && (
        <p className="v2-class---paragraph" role="alert">
          {FAILED_TEXT}
        </p>
      )}
    </div>
  );
}
