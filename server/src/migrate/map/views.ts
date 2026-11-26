import { isGuid } from "../../providers/azure-legacy/mapping.js";
import type { ViewRec } from "../records.js";
import type { Report } from "./report.js";
import { viewStateOf } from "../../domain/view-state.js";
import { withoutBom, withoutNul } from "./text.js";

/**
 * A user's saved results layout from its blob `{surveyId}/{userId}/{view}`. A zero-byte blob is a
 * reset marker (no state); text that is not a JSON object is kept as no state and reported, as the
 * app's reader answers "no layout" for it too.
 */
export function mapView(
  blobName: string,
  text: string,
  lastModified: Date,
  report: Report,
): ViewRec | null {
  const [surveyId, userId, view, ...rest] = blobName.split("/");
  if (
    !surveyId ||
    !userId ||
    rest.length > 0 ||
    (view !== "summary" && view !== "table") ||
    !isGuid(surveyId) ||
    !isGuid(userId)
  ) {
    report.skip("view", { blob: blobName.toLowerCase() }, "the blob name is not survey/user/view");
    return null;
  }
  const ids = { surveyId: surveyId.toLowerCase(), userId: userId.toLowerCase() };
  let state: unknown = null;
  if (text !== "") {
    const object = viewStateOf(withoutBom(text));
    if (object === null) report.note("view_unreadable", ids);
    else state = withoutNul(object, ids, report);
  }
  return { ...ids, view, state, updatedAt: lastModified.toISOString() };
}
