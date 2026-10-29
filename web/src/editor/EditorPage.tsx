import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
  type QueryClient,
} from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { lazy, Suspense, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
import { uploadSurveyAsset } from "../api/files";
import { surveyQueryOptions, type Survey } from "../api/surveys";
import { useLicenceApplied } from "../surveyjs/useLicenceApplied";
import {
  createDocumentSaver,
  editorStatus,
  isSafeToLeave,
  statusText,
  type EditorStatus,
  type SaverState,
} from "./autosave";
import styles from "./editor.module.css";
import { FooterNameEditor } from "./FooterNameEditor";
import type { EditorDocuments, EditorSaves, EditorUploads } from "./SurveyEditor";

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
  return (
    <EditorSession
      survey={survey}
      definition={definition.data}
      theme={theme.data}
      maxAssetBytesPerSurvey={config.limits.maxAssetBytesPerSurvey}
      serverReadOnly={config.readOnly}
      // Only the surveyjs-site shell offers the Embed tabs (D21); a server without features does.
      embed={config.features?.embed ?? true}
    />
  );
}

/** The open editor: the Creator, its savers, the status and the conflict notice. */
function EditorSession({
  survey,
  definition,
  theme,
  maxAssetBytesPerSurvey,
  serverReadOnly,
  embed,
}: {
  survey: Survey;
  /** The documents as first read; later reads come from "Reload latest". */
  definition: VersionedDocument<SurveyDefinition>;
  theme: VersionedDocument<SurveyTheme>;
  /** The configured upload quota per survey. */
  maxAssetBytesPerSurvey: number;
  /** The server refuses every write (`READ_ONLY`): open like a survey without modify rights. */
  serverReadOnly: boolean;
  /** The Embed Survey and Embed Creator tabs (`/config.features.embed`). */
  embed: boolean;
}) {
  const queryClient = useQueryClient();
  // Fixed for the session: the savers exist or not from the start.
  const [readOnly] = useState(serverReadOnly || !survey.permissions.canModify);
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
  // Fixed for the session, like the savers: a new object would build a new Creator.
  const [uploads] = useState<EditorUploads | null>(() =>
    readOnly
      ? null
      : { upload: (file) => uploadSurveyAsset(survey.id, file), maxAssetBytesPerSurvey },
  );
  const [documents, setDocuments] = useState<EditorDocuments>(() => ({
    definition: definition.content,
    theme: theme.content,
  }));
  // The ETags of the last "Reload latest", with the documents object they belong to. The savers
  // start again only once the Creator holds those documents: until then a change made before the
  // reload could still be saved, over the reloaded content.
  const reloaded = useRef<{
    documents: EditorDocuments;
    definitionEtag: string;
    themeEtag: string;
  } | null>(null);
  const [reloading, setReloading] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  // A change the Creator holds for its auto-save delay, not yet handed to a saver.
  const [pendingChange, setPendingChange] = useState(false);
  const status = editorStatus(states, readOnly, pendingChange);
  useLeaveGuard(!isSafeToLeave(status));

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
      const latest = { definition: latestDefinition.content, theme: latestTheme.content };
      reloaded.current = {
        documents: latest,
        definitionEtag: latestDefinition.etag,
        themeEtag: latestTheme.etag,
      };
      setDocuments(latest);
    } catch {
      setReloadFailed(true);
    } finally {
      setReloading(false);
    }
  };

  const documentsLoaded = (loaded: EditorDocuments) => {
    const latest = reloaded.current;
    if (savers === null || latest === null || latest.documents !== loaded) return;
    reloaded.current = null;
    savers.reset(latest.definitionEtag, latest.themeEtag);
  };

  return (
    <EditorFrame
      survey={survey}
      readOnly={readOnly}
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
          uploads={uploads}
          onPendingChange={setPendingChange}
          onDocumentsLoaded={documentsLoaded}
          embed={embed}
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
  readOnly = !survey.permissions.canModify,
  status,
  notice,
  children,
}: {
  survey: Survey;
  readOnly?: boolean;
  status?: EditorStatus;
  notice?: ReactNode;
  children?: ReactNode;
}) {
  const [renameFailed, setRenameFailed] = useState(false);
  // The root route shows the read-only banner above the page; the Creator makes room for it.
  const belowBanner = rootRoute.useLoaderData().readOnly;
  return (
    <>
      <div
        id="creator"
        className={`editor-editor v2-class---my-surveys-edit-survey ${styles.creator}${belowBanner ? ` ${styles.belowBanner}` : ""}`}
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
          readOnly={readOnly}
          onRenameStart={() => setRenameFailed(false)}
          onRenamed={(ok) => setRenameFailed(!ok)}
        />
      </div>
    </>
  );
}

/**
 * While `active`, closing the tab, reloading or leaving for another site asks first (the browser's
 * own prompt). Leaving within the app needs no prompt: the editor hands its pending changes to the
 * savers when it closes, and they finish on their own.
 *
 * A layout effect: the listener changes in the same commit as the status the bar shows. A passive
 * effect runs in a later task, so for a moment the bar could say "Saving…" while leaving does not
 * ask yet.
 */
function useLeaveGuard(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return;
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers (Chrome and Edge before 119) ask only when `returnValue` is set.
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [active]);
}

/** Stands for a save that was not sent because the other document ran into a conflict. */
class StoppedByConflict extends Error {}

const isConflict = (error: unknown) =>
  error instanceof StoppedByConflict ||
  (error instanceof ApiError && error.problem.code === "edit-conflict");

/**
 * The two savers of the open survey. A conflict on either document stops both: requests fail at
 * once, and a save the other saver has queued fails as a conflict without being sent. `reset`
 * (once the Creator holds the documents of "Reload latest") starts both again with their ETags.
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
