import type { BlobServiceClient } from "@azure/storage-blob";
import type { LayoutKind } from "../../domain/types.js";
import { viewStateOf } from "../../domain/view-state.js";
import type { ViewStore } from "../types.js";
import { LegacyStoreError, statusOf } from "./errors.js";
import type { LegacyWarningLogger } from "./index.js";
import { LAYOUT_CONTAINERS_BY_KIND, isGuid, privateQuestionsFromLegacy } from "./mapping.js";
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

export function createAzureViewStore(options: {
  readonly blobs: BlobServiceClient;
  readonly logger: LegacyWarningLogger;
}): ViewStore {
  const { blobs, logger } = options;
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

    // Fails closed: a list that exists but cannot be read never means "every question public".
    // An empty blob is usually a save between its create and its append, so it is read once more.
    async getPrivateQuestions(surveyId) {
      if (!isGuid(surveyId)) return [];
      const survey = surveyId.toLowerCase();
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const text = await textOf(blobs, PERMISSIONS_CONTAINER, survey, PERMISSIONS_READ);
        if (text === undefined) return [];
        const names = privateQuestionsFromLegacy(text);
        if (names !== null) return names;
      }
      throw new LegacyStoreError(PERMISSIONS_READ, undefined);
    },

    savePrivateQuestions: (surveyId, names) => writePrivateQuestions(blobs, surveyId, names),
  };
}
