import type { BlobServiceClient } from "@azure/storage-blob";
import type { LayoutKind, SurveyDefinition } from "../../domain/types.js";
import { viewStateOf } from "../../domain/view-state.js";
import { questionsOf } from "../../results/definition.js";
import type { ResultsPrivacy, ViewStore } from "../types.js";
import { LegacyStoreError, statusOf } from "./errors.js";
import type { LegacyWarningLogger } from "./index.js";
import {
  LAYOUT_CONTAINERS_BY_KIND,
  isGuid,
  permissionsListFromLegacy,
  privateQuestionsToLegacy,
  resultsPrivacyFromLegacy,
} from "./mapping.js";
import {
  PERMISSIONS_CONTAINER,
  VIEWS_CONTAINER,
  writeLayout,
  writeLayoutDeletion,
  writePrivateQuestions,
  writeView,
  writeViewReset,
} from "./writes.js";

/**
 * Saved results layouts (Step 9, R4 to R7): block blob `{surveyId}/{userId}/{view}` (lower case) in
 * the surveys account's container `my-surveys-views`, which legacy code never reads. A blob of zero
 * bytes is a reset marker. Without an own blob a read falls back to the survey's shared layout.
 *
 * The shared layouts (ADR 0040 point 4) are the old service's per-survey layout blobs
 * `{container}/{surveyId}` of `LAYOUT_CONTAINERS_BY_KIND` (`surveyresulttablestate`,
 * `surveyresultsummarystate`, `surveyresultcolumns`), read and written in place, so the old site
 * and Studio see one copy.
 *
 * Reads only here (the folder is read-only by lint); saves, resets and deletes call writes.ts. Logs
 * hold ids and view names, never layout content.
 */

/** The text of a blob; undefined when the blob or its container is missing. */
async function textOf(
  blobs: BlobServiceClient,
  container: string,
  name: string,
  operation = "view read",
): Promise<string | undefined> {
  try {
    const bytes = await blobs.getContainerClient(container).getBlobClient(name).downloadToBuffer();
    return bytes.toString("utf8");
  } catch (error) {
    if (statusOf(error) === 404) return undefined;
    throw new LegacyStoreError(operation, error);
  }
}

const PERMISSIONS_READ = "public questions read";
const LAYOUT_READ = "layout read";
const NO_PRIVACY: ResultsPrivacy = { privateQuestions: [], publicOnly: null, lockedQuestions: [] };

export function createAzureViewStore(options: {
  readonly blobs: BlobServiceClient;
  readonly logger: LegacyWarningLogger;
  /** The survey's definition (`SurveyStore.getDefinition`); null for an unknown survey. */
  readonly definitionOf: (surveyId: string) => Promise<SurveyDefinition | null>;
}): ViewStore {
  const { blobs, logger, definitionOf } = options;
  const ignored = (ids: Record<string, string>): null => {
    logger.warn(ids, "Ignored a saved results layout that is not a JSON object.");
    return null;
  };

  /**
   * The text of the shared layout of a lower-case GUID survey; null without a blob, and for an
   * empty one (an old save between its create and its append, or one that failed half way).
   */
  const layoutOf = async (survey: string, kind: LayoutKind): Promise<string | null> => {
    const text = await textOf(blobs, LAYOUT_CONTAINERS_BY_KIND[kind], survey, LAYOUT_READ);
    return text === undefined || text === "" ? null : text;
  };

  return {
    async getView(surveyId, userId, view) {
      if (!isGuid(surveyId) || !isGuid(userId)) return null;
      const survey = surveyId.toLowerCase();
      const user = userId.toLowerCase();
      const own = await textOf(blobs, VIEWS_CONTAINER, `${survey}/${user}/${view}`);
      if (own !== undefined) {
        if (own === "") return null; // a reset marker
        return viewStateOf(own) ?? ignored({ surveyId: survey, userId: user, view });
      }
      const shared = await layoutOf(survey, view);
      if (shared === null) return null;
      return viewStateOf(shared) ?? ignored({ surveyId: survey, view });
    },

    saveView: (surveyId, userId, view, state) => writeView(blobs, surveyId, userId, view, state),

    resetView: (surveyId, userId, view) => writeViewReset(blobs, surveyId, userId, view),

    getLayout: (surveyId, kind) =>
      isGuid(surveyId) ? layoutOf(surveyId.toLowerCase(), kind) : Promise.resolve(null),

    saveLayout: (surveyId, kind, text) => writeLayout(blobs, surveyId, kind, text),

    deleteLayout: (surveyId, kind) => writeLayoutDeletion(blobs, surveyId, kind),

    getResultsPrivacy: privacyOf,

    getPrivateQuestions: async (surveyId) => (await privacyOf(surveyId)).privateQuestions,

    // The old service's full form: every question of the definition, and the stored list's names.
    // With an old results layout a stored name the definition does not have keeps its mark, so a
    // list that leaves out a stored private one (the submit time) never makes it public.
    async savePrivateQuestions(surveyId, names) {
      if (!isGuid(surveyId)) return writePrivateQuestions(blobs, surveyId, "[]"); // rejects
      const survey = surveyId.toLowerCase();
      const [definition, stored, layout] = await Promise.all([
        definitionOf(survey),
        textOf(blobs, PERMISSIONS_CONTAINER, survey, PERMISSIONS_READ),
        layoutOf(survey, "columns"),
      ]);
      const questions = questionsOf(definition ?? {}).map(({ name }) => name);
      const text = privateQuestionsToLegacy(names, questions, stored ?? null, layout !== null);
      return writePrivateQuestions(blobs, survey, text);
    },
  };

  /**
   * The permissions blob text; null without a blob. Fails closed: a list that exists but cannot be
   * read never means "every question public". An empty blob is usually a save between its create
   * and its append, so it is read once more.
   */
  async function permissionsOf(survey: string): Promise<string | null> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const text = await textOf(blobs, PERMISSIONS_CONTAINER, survey, PERMISSIONS_READ);
      if (text === undefined) return null;
      if (permissionsListFromLegacy(text) !== null) return text;
    }
    throw new LegacyStoreError(PERMISSIONS_READ, undefined);
  }

  /**
   * The old public results' rule on the permissions blob and the old results column layout (ADR
   * 0016, changed 2026-11-26). Without a layout the rule needs no answer names, so the definition
   * is read only with one. A layout the old calculation fails on rejects, as an unreadable list.
   */
  async function privacyOf(surveyId: string): Promise<ResultsPrivacy> {
    if (!isGuid(surveyId)) return NO_PRIVACY;
    const survey = surveyId.toLowerCase();
    const [permissions, layout] = await Promise.all([
      permissionsOf(survey),
      layoutOf(survey, "columns"),
    ]);
    const definition = layout === null ? {} : ((await definitionOf(survey)) ?? {});
    const { unreadable, ...privacy } = resultsPrivacyFromLegacy(permissions, layout, definition);
    if (unreadable.length > 0) throw new LegacyStoreError(LAYOUT_READ, undefined);
    return privacy;
  }
}
