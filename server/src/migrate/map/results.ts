import type { HistoryEntryRecord, SurveyResponse } from "../../domain/types.js";
import {
  isGuid,
  responseFromLegacy,
  UnmappableLegacyRowError,
} from "../../providers/azure-legacy/mapping.js";
import type { LegacyResultEntity } from "../../providers/azure-legacy/rows.js";
import { historyOrder } from "../../providers/ordering.js";
import type { DeletedRec, HistoryRec, ResponseRec } from "../records.js";
import type { Report } from "./report.js";
import { objectOf, withoutBom, withoutNul } from "./text.js";

const HISTORY_KEEP = 20;

/** The response of a row, BOM and NUL handled; null (reported under `entity`) when unmappable. */
function readResponse(
  entity: string,
  surveyId: string,
  row: LegacyResultEntity,
  report: Report,
): SurveyResponse | null {
  const ids = { surveyId, responseId: row.id.toLowerCase() };
  if (!isGuid(row.id)) {
    report.skip(entity, ids, "the id is not a GUID");
    return null;
  }
  let response: SurveyResponse;
  try {
    response = responseFromLegacy({ ...row, result: withoutBom(row.result) });
  } catch (error) {
    if (!(error instanceof UnmappableLegacyRowError)) throw error;
    report.skip(entity, ids, error.message);
    return null;
  }
  const clean = withoutNul({ ...response }, ids, report);
  return clean;
}

/** A response (a `post{postId}` row) of the survey; the client id is kept as stored. */
export function mapResponse(
  surveyId: string,
  entity: LegacyResultEntity,
  report: Report,
): ResponseRec | null {
  const id = surveyId.toLowerCase();
  const response = readResponse("response", id, entity, report);
  return response === null ? null : { surveyId: id, response };
}

/** A deleted-response copy: answers, client id, partial flag and IP in one JSON object. */
export function mapDeleted(
  surveyId: string,
  copy: { responseId: string; deletedAt: Date; entity: LegacyResultEntity },
  report: Report,
): DeletedRec | null {
  const id = surveyId.toLowerCase();
  const response = readResponse(
    "deleted_response",
    id,
    { ...copy.entity, id: copy.responseId },
    report,
  );
  if (response === null) return null;
  const { data, clientId, partial, respondentIp } = response;
  return {
    surveyId: id,
    responseId: response.id,
    deletedAt: copy.deletedAt.toISOString(),
    response: JSON.stringify({ data, clientId, partial, respondentIp }),
  };
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
