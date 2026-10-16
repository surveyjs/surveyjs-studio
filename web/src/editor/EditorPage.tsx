import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
  type QueryClient,
} from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import {
  definitionQueryOptions,
  markSavedContentStale,
  saveDefinition,
  saveTheme,
  themeQueryOptions,
  type SurveyDefinition,
  type SurveyTheme,
  type VersionedDocument,
} from "../api/content";
import { surveyQueryOptions, type Survey } from "../api/surveys";
import { applySurveyJSLicense } from "../surveyjs/license";
import {
  createDocumentSaver,
  editorStatus,
  statusText,
  type EditorStatus,
  type SaverState,
} from "./autosave";
import styles from "./editor.module.css";
import { FooterNameEditor } from "./FooterNameEditor";
import type { EditorDocuments, EditorSaves } from "./SurveyEditor";

// The Creator and its styles load only here, on demand: nothing the survey list or this page's
// own chunk imports pulls them in.
const SurveyEditor = lazy(async () => ({ default: (await import("./SurveyEditor")).SurveyEditor }));

const rootRoute = getRouteApi("__root__");

const CONFLICT_TEXT = "The survey was changed by someone else. Your latest changes are not saved.";
const RENAME_FAILED_TEXT = "Could not rename the survey. Please try again.";

/**
 * The editor page (`/surveys/$surveyId/edit`), as surveyjs.io's `the site's page markup`: the Creator
 * fills the page, the site footer is hidden, and a fixed bar at the bottom shows the save status
 * and the survey name. The definition and the theme are read fresh on every open.
 */
export function EditorPage({ surveyId }: { surveyId: string }) {
  const { data: survey } = useSuspenseQuery(surveyQueryOptions(surveyId));
  const config = rootRoute.useLoaderData();
  const licenceApplied = useLicenceApplied(config.surveyjsLicenseKey ?? null);
  const definition = useQuery(definitionQueryOptions(surveyId));
  const theme = useQuery(themeQueryOptions(surveyId));

  // Only a first read that failed: once the editor is open, a failed "Reload latest" also puts
  // these queries in error (with their data kept), and the open editor must stay.
  const definitionFailed = definition.isError && definition.data === undefined;
  const themeFailed = theme.isError && theme.data === undefined;
  if (definitionFailed || themeFailed) {
    const retry = () => {
      if (definitionFailed) void definition.refetch();
      if (themeFailed) void theme.refetch();
    };
    return (
      <EditorFrame
        survey={survey}
        notice={
          <div className={styles.notice} role="alert">
            <span>Could not load the survey. Please try again.</span>
            <button type="button" className={styles.noticeButton} onClick={retry}>
              Try again
            </button>
          </div>
        }
      />
    );
  }
  if (definition.data === undefined || theme.data === undefined || !licenceApplied) {
    return <EditorFrame survey={survey} />;
  }
  return <EditorSession survey={survey} definition={definition.data} theme={theme.data} />;
}

/** The open editor: the Creator, its savers, the status and the conflict notice. */
function EditorSession({
  survey,
  definition,
  theme,
}: {
  survey: Survey;
  /** The documents as first read; later reads come from "Reload latest". */
  definition: VersionedDocument<SurveyDefinition>;
  theme: VersionedDocument<SurveyTheme>;
}) {
  const queryClient = useQueryClient();
  // Fixed for the session: the savers exist or not from the start.
  const [readOnly] = useState(!survey.permissions.canModify);
  const [states, setStates] = useState<readonly SaverState[]>(["saved", "saved"]);
  const [savers] = useState(() =>
    readOnly
      ? null
      : createContentSavers({
          queryClient,
          surveyId: survey.id,
          definitionEtag: definition.etag,
          themeEtag: theme.etag,
          onChange: setStates,
        }),
  );
  const [documents, setDocuments] = useState<EditorDocuments>(() => ({
    definition: definition.content,
    theme: theme.content,
  }));
  const [reloading, setReloading] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  const status = editorStatus(states, readOnly);

  const reload = async () => {
    if (savers === null) return;
    setReloading(true);
    setReloadFailed(false);
    try {
      // staleTime 0: always ask the server, whatever the cache holds.
      const [latestDefinition, latestTheme] = await Promise.all([
        queryClient.fetchQuery({ ...definitionQueryOptions(survey.id), staleTime: 0 }),
        queryClient.fetchQuery({ ...themeQueryOptions(survey.id), staleTime: 0 }),
      ]);
      savers.reset(latestDefinition.etag, latestTheme.etag);
      setDocuments({ definition: latestDefinition.content, theme: latestTheme.content });
    } catch {
      setReloadFailed(true);
    } finally {
      setReloading(false);
    }
  };

  return (
    <EditorFrame
      survey={survey}
      status={status}
      notice={
        status.kind === "conflict" && (
          <div className={styles.notice} role="alert">
            <span>{CONFLICT_TEXT}</span>
            {reloadFailed && <span>Could not reload the survey. Please try again.</span>}
            <button
              type="button"
              className={styles.noticeButton}
              // A save still in flight could land after the reload read and conflict again.
              disabled={reloading || states.includes("saving")}
              onClick={() => void reload()}
            >
              Reload latest
            </button>
          </div>
        )
      }
    >
      <Suspense fallback={null}>
        <SurveyEditor
          surveyId={survey.id}
          documents={documents}
          saves={savers === null ? null : savers.saves}
        />
      </Suspense>
    </EditorFrame>
  );
}

/**
 * The page around the Creator, in the markup of `the site's page markup`: the `#creator` container and
 * the fixed bottom bar with the survey name and its rename editor (the status at its left is ours).
 * Notices take the top of the container and the Creator the rest, so no part of the Creator slides
 * under the bar. A failed rename shows a notice until the next rename.
 */
function EditorFrame({
  survey,
  status,
  notice,
  children,
}: {
  survey: Survey;
  status?: EditorStatus;
  notice?: ReactNode;
  children?: ReactNode;
}) {
  const [renameFailed, setRenameFailed] = useState(false);
  return (
    <>
      <div
        id="creator"
        className={`editor-editor v2-class---my-surveys-edit-survey ${styles.creator}`}
      >
        {notice}
        {renameFailed && (
          <div className={styles.notice} role="alert">
            <span>{RENAME_FAILED_TEXT}</span>
          </div>
        )}
        <div className={styles.creatorArea}>{children}</div>
      </div>
      <div
        id="edit-survey-change-name-container"
        className="v2-class---edit-survey-change-name-container"
      >
        <span className={styles.status} role="status">
          {status === undefined
            ? ""
            : statusText[status.kind === "conflict" ? "error" : status.kind]}
        </span>
        <FooterNameEditor
          survey={survey}
          readOnly={!survey.permissions.canModify}
          onRenameStart={() => setRenameFailed(false)}
          onRenamed={(ok) => setRenameFailed(!ok)}
        />
      </div>
    </>
  );
}

/** Applies the SurveyJS licence key before the Creator is built (the Creator reads it then). */
function useLicenceApplied(key: string | null): boolean {
  const [applied, setApplied] = useState(key === null);
  useEffect(() => {
    if (key === null) return;
    let active = true;
    applySurveyJSLicense(key)
      .catch((error: unknown) => console.warn("Could not apply the SurveyJS licence key", error))
      .finally(() => {
        if (active) setApplied(true);
      });
    return () => {
      active = false;
    };
  }, [key]);
  return applied;
}

/** Stands for a save that was not sent because the other document ran into a conflict. */
class StoppedByConflict extends Error {}

const isConflict = (error: unknown) =>
  error instanceof StoppedByConflict ||
  (error instanceof ApiError && error.problem.code === "edit-conflict");

/**
 * The two savers of the open survey. A conflict on either document stops both: requests fail at
 * once, and a save the other saver has queued fails as a conflict without being sent. `reset`
 * (after "Reload latest") starts both again with the new ETags.
 */
function createContentSavers(options: {
  queryClient: QueryClient;
  surveyId: string;
  definitionEtag: string;
  themeEtag: string;
  onChange: (states: readonly SaverState[]) => void;
}) {
  const { queryClient, surveyId } = options;
  let stopped = false;

  const saved = () => {
    const survey = queryClient.getQueryData(surveyQueryOptions(surveyId).queryKey);
    if (survey !== undefined) markSavedContentStale(queryClient, survey);
  };
  const guarded =
    <T,>(save: (surveyId: string, content: T, etag: string) => Promise<string>) =>
    async (content: T, etag: string) => {
      if (stopped) throw new StoppedByConflict();
      const newEtag = await save(surveyId, content, etag);
      saved();
      return newEtag;
    };

  const report = () => options.onChange([definition.state, theme.state]);
  const onChange = (state: SaverState) => {
    if (state === "conflict") stopped = true;
    report();
  };
  const definition = createDocumentSaver<SurveyDefinition>({
    etag: options.definitionEtag,
    save: guarded(saveDefinition),
    isConflict,
    onChange,
  });
  const theme = createDocumentSaver<SurveyTheme>({
    etag: options.themeEtag,
    save: guarded(saveTheme),
    isConflict,
    onChange,
  });

  const saves: EditorSaves = {
    definition: (content, done) => (stopped ? done(false) : definition.request(content, done)),
    theme: (content, done) => (stopped ? done(false) : theme.request(content, done)),
  };
  return {
    saves,
    reset(definitionEtag: string, themeEtag: string) {
      stopped = false;
      definition.reset(definitionEtag);
      theme.reset(themeEtag);
      report();
    },
  };
}
