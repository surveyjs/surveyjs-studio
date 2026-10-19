import type { HistoryEntryRecord, ProjectMembership, SurveyRecord } from "../domain/types.js";
import type { HistoryPosition, SurveyPosition } from "./types.js";

/** The list orders of the store interfaces (types.ts), shared so every provider sorts alike. */

/** Code-point order: the same on every machine, whatever the locale. */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** updatedAt descending, then id ascending. */
export const surveyListOrder = (a: SurveyRecord, b: SurveyRecord): number =>
  compare(b.updatedAt, a.updatedAt) || compare(a.id, b.id);

/**
 * Whether the survey comes after the position in `surveyListOrder`: updated earlier, or at the
 * same time with a greater id. Times are compared as instants, so a position written without
 * milliseconds still matches.
 */
export function isAfter(survey: SurveyRecord, position: SurveyPosition): boolean {
  const updated = Date.parse(survey.updatedAt);
  const at = Date.parse(position.updatedAt);
  return updated < at || (updated === at && survey.id > position.id);
}

/**
 * Project name ignoring case ("alpha" before "Beta"), then project id. Names are lower-cased
 * rather than compared with a locale, so the order does not depend on the machine.
 */
export const projectListOrder = (a: ProjectMembership, b: ProjectMembership): number =>
  compare(a.project.name.toLowerCase(), b.project.name.toLowerCase()) ||
  compare(a.project.id, b.project.id);

/** History order: `at` descending, then id descending (code-point order of the lower-case ids). */
export const historyOrder = (a: HistoryEntryRecord, b: HistoryEntryRecord): number =>
  Date.parse(b.at) - Date.parse(a.at) || compare(b.id, a.id);

/** Whether the entry comes after the position in `historyOrder` (times compared as instants). */
export function isAfterHistory(entry: HistoryEntryRecord, position: HistoryPosition): boolean {
  const at = Date.parse(entry.at);
  const after = Date.parse(position.at);
  return at < after || (at === after && entry.id < position.id.toLowerCase());
}
