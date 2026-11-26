import type { HistoryEntryRecord, SurveyResponse } from "../../domain/types.js";
import {
  isGuid,
  responseFromLegacy,
  UnmappableLegacyRowError,
} from "../../providers/azure-legacy/mapping.js";
import { historyOrder } from "../../providers/ordering.js";
import type { DeletedRec, HistoryRec, MarkerRec, ResponseRec } from "../records.js";
import type { DeletionCopy, ResultRow } from "../source/tables.js";
import type { Report } from "./report.js";
import { objectOf, withoutBom, withoutNul } from "./text.js";

/** History entries kept per survey: the newest by (at desc, id desc). */
export const HISTORY_KEEP = 20;

/**
 * The response of a row, BOM and NUL handled; null (reported under `entity`) when unmappable, as
 * the app's reader skips it: an id that is not a GUID, a time that is not a date, a result that
 * is not a JSON object.
 */
function readResponse(
  entity: string,
  surveyId: string,
  row: ResultRow,
  report: Report,
): SurveyResponse | null {
  const ids = { surveyId, responseId: row.id.toLowerCase() };
  if (!isGuid(row.id)) {
    report.skip(entity, ids, "the id is not a GUID");
    return null;
  }
  const { happendat } = row;
  if (happendat === null) {
    report.skip(entity, ids, "the time is not a date");
    return null;
  }
  let response: SurveyResponse;
  try {
    response = responseFromLegacy({ ...row, happendat, result: withoutBom(row.result) });
  } catch (error) {
    if (!(error instanceof UnmappableLegacyRowError)) throw error;
    report.skip(entity, ids, error.message);
    return null;
  }
  const clean = withoutNul({ ...response }, ids, report);
  return clean;
}

/**
 * A response (a `post{postId}` row) of the survey; the client id is kept as stored. Its id is the
 * row key, as the app reads it; a row whose `id` property says otherwise is noted.
 */
export function mapResponse(
  surveyId: string,
  entity: ResultRow,
  report: Report,
): ResponseRec | null {
  const id = surveyId.toLowerCase();
  const response = readResponse("response", id, entity, report);
  if (response === null) return null;
  if (entity.idProperty !== undefined && entity.idProperty.toLowerCase() !== response.id) {
    report.note("response_id_differs", { surveyId: id, responseId: response.id });
  }
  return { surveyId: id, response };
}

/**
 * A deleted-response copy: answers, client id, partial flag and IP in one JSON object, deleted at
 * the copy's time. A copy without one is kept, deleted at its storage time, and noted
 * (`deleted_copy_undated`): the deleted response's answers are kept nowhere else.
 */
export function mapDeleted(
  surveyId: string,
  copy: DeletionCopy,
  report: Report,
): DeletedRec | null {
  const id = surveyId.toLowerCase();
  const response = readResponse(
    "deleted_response",
    id,
    { ...copy.entity, id: copy.responseId, happendat: copy.deletedAt ?? copy.timestamp },
    report,
  );
  if (response === null) return null;
  if (copy.deletedAt === null) {
    report.note("deleted_copy_undated", { surveyId: id, responseId: response.id });
  }
  const { data, clientId, partial, respondentIp } = response;
  return {
    surveyId: id,
    responseId: response.id,
    deletedAt: response.submittedAt,
    response: JSON.stringify({ data, clientId, partial, respondentIp }),
  };
}

/**
 * A completion marker: partial only for a stored Boolean true. A flag stored as anything else
 * (the old reader also took the text "1" as partial) is noted, by the survey only: a client id
 * can be an email.
 */
export function mapMarker(
  surveyId: string,
  marker: { clientId: string; ispartialcompleted: unknown },
  report: Report,
): MarkerRec {
  const id = surveyId.toLowerCase();
  const flag = marker.ispartialcompleted;
  if (flag !== undefined && flag !== null && typeof flag !== "boolean") {
    report.note("marker_partial_not_boolean", { surveyId: id });
  }
  return { surveyId: id, clientId: marker.clientId, partial: flag === true };
}

/**
 * The 20 newest snapshots of a survey, by time then id (newest first). A snapshot that is not a
 * JSON object is skipped and reported; the rest are copied.
 */
export function mapHistory(
  surveyId: string,
  entries: { entry: HistoryEntryRecord; text: string }[],
  report: Report,
): HistoryRec[] {
  const id = surveyId.toLowerCase();
  const out: HistoryRec[] = [];
  for (const { entry, text } of [...entries]
    .sort((a, b) => historyOrder(a.entry, b.entry))
    .slice(0, HISTORY_KEEP)) {
    const ids = { surveyId: id, historyId: entry.id.toLowerCase() };
    const snapshot = objectOf(text);
    if (snapshot === null) {
      report.skip("history_entry", ids, "the snapshot is not a JSON object");
      continue;
    }
    out.push({
      surveyId: id,
      id: ids.historyId,
      at: entry.at,
      userId: entry.userId === null ? null : entry.userId.toLowerCase(),
      snapshot: withoutNul(snapshot, ids, report),
    });
  }
  return out;
}
