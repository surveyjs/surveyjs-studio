import type { ProjectMembership, SurveyRecord } from "../domain/types.js";

/** The list orders of the store interfaces (types.ts), shared so every provider sorts alike. */

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** updatedAt descending, then id ascending. */
export const surveyListOrder = (a: SurveyRecord, b: SurveyRecord): number =>
  compare(b.updatedAt, a.updatedAt) || compare(a.id, b.id);

/** Project name, then project id. */
export const projectListOrder = (a: ProjectMembership, b: ProjectMembership): number =>
  compare(a.project.name, b.project.name) || compare(a.project.id, b.project.id);
