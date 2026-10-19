import type { BlobServiceClient } from "@azure/storage-blob";
import type { ViewName, ViewState } from "../../domain/types.js";
import type { ViewStore } from "../types.js";
import { LegacyStoreError, statusOf } from "./errors.js";
import type { LegacyWarningLogger } from "./index.js";
import { isGuid } from "./mapping.js";
import { VIEWS_CONTAINER, writeView, writeViewReset } from "./writes.js";

/**
 * Saved results layouts (Step 9, R4 to R7): block blob `{surveyId}/{userId}/{view}` (lower case) in
 * the surveys account's container `my-surveys-views`, which legacy code never reads. A blob of zero
 * bytes is a reset marker. Without an own blob a read falls back to the survey's legacy layout blob
 * (`surveyresultsummarystate/{id}` or `surveyresulttablestate/{id}`), read only.
 *
 * Reads only here (the folder is read-only by lint); saves and resets call writes.ts. Logs hold ids
 * and view names, never layout content.
 */
const LEGACY_CONTAINERS: Readonly<Record<ViewName, string>> = {
  summary: "surveyresultsummarystate",
  table: "surveyresulttablestate",
};

/** The text of a blob; undefined when the blob or its container is missing. */
async function textOf(
  blobs: BlobServiceClient,
  container: string,
  name: string,
): Promise<string | undefined> {
  try {
    const bytes = await blobs.getContainerClient(container).getBlobClient(name).downloadToBuffer();
    return bytes.toString("utf8");
  } catch (error) {
    if (statusOf(error) === 404) return undefined;
    throw new LegacyStoreError("view read", error);
  }
}

/** The JSON object in `text`; null when it is not one. */
function parseState(text: string): ViewState | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as ViewState)
      : null;
  } catch {
    return null;
  }
}

export function createAzureViewStore(options: {
  readonly blobs: BlobServiceClient;
  readonly logger: LegacyWarningLogger;
}): ViewStore {
  const { blobs, logger } = options;
  const ignored = (ids: Record<string, string>): null => {
    logger.warn(ids, "Ignored a saved results layout that is not a JSON object.");
    return null;
  };

  return {
    async getView(surveyId, userId, view) {
      if (!isGuid(surveyId) || !isGuid(userId)) return null;
      const survey = surveyId.toLowerCase();
      const user = userId.toLowerCase();
      const own = await textOf(blobs, VIEWS_CONTAINER, `${survey}/${user}/${view}`);
      if (own !== undefined) {
        if (own === "") return null; // a reset marker
        return parseState(own) ?? ignored({ surveyId: survey, userId: user, view });
      }
      const legacy = await textOf(blobs, LEGACY_CONTAINERS[view], survey);
      if (legacy === undefined) return null;
      return parseState(legacy) ?? ignored({ surveyId: survey, view });
    },

    saveView: (surveyId, userId, view, state) => writeView(blobs, surveyId, userId, view, state),

    resetView: (surveyId, userId, view) => writeViewReset(blobs, surveyId, userId, view),
  };
}
