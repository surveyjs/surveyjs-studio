// Survey records and their contract shape. Mirrors server/src/surveys/json.ts (the Survey JSON),
// domain/survey-changes.ts (a new record) and files/rewrite.ts. The sandbox code does not import
// server/src.
import type { SandboxSurvey } from "../seed-types";
import type { SandboxData } from "../store";
import { lower } from "./common";

/** The contract `Survey` of a record; the private-question list only when `privateQuestions` is given. */
export function surveyJson(
  survey: SandboxSurvey,
  canModifySurvey: boolean,
  privateQuestions?: readonly string[],
) {
  return {
    id: survey.id,
    name: survey.name,
    projectId: survey.owner.kind === "project" ? survey.owner.projectId : null,
    published: survey.published,
    archived: survey.archived,
    createdAt: survey.createdAt,
    updatedAt: survey.updatedAt,
    postId: survey.postId,
    resultId: survey.resultId,
    permissions: { canModify: canModifySurvey },
    settings: {
      publicResults: survey.settings.publicResults,
      storeRespondentIp: survey.settings.storeRespondentIp,
      ...(privateQuestions && { privateResultQuestions: [...privateQuestions] }),
    },
  };
}

/** A new record with the legacy defaults: published, active, no settings (survey-changes.ts). */
export function newSurvey(
  fields: Pick<SandboxSurvey, "id" | "name" | "owner" | "creatorId" | "postId" | "resultId"> & {
    now: string;
  },
): SandboxSurvey {
  const { now, ...rest } = fields;
  return {
    ...rest,
    published: true,
    archived: false,
    createdAt: now,
    updatedAt: now,
    settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
  };
}

/** Removes everything that belongs to a survey (ADR 0010: children first; here, one write). */
export function dropSurvey(data: SandboxData, surveyId: string): void {
  const id = lower(surveyId);
  data.surveys = data.surveys.filter((survey) => survey.id !== id);
  for (const map of [
    data.definitions,
    data.themes,
    data.history,
    data.responses,
    data.completions,
    data.legacyViews,
    data.privateResultQuestions,
    data.idempotencyKeys,
  ] as Record<string, unknown>[]) {
    delete map[id];
  }
  for (const views of Object.values(data.savedViews)) delete views[id];
  data.files = data.files.filter((file) => file.surveyId !== id);
}

export const privateQuestionsOf = (data: SandboxData, surveyId: string): string[] => [
  ...(data.privateResultQuestions[surveyId] ?? []),
];

/** The ids of the files in a text, replaced by their copies' ids (files/rewrite.ts). */
export function rewriteFileIds(text: string, ids: ReadonlyMap<string, string>): string {
  let result = text;
  for (const [oldId, newId] of ids) result = result.replaceAll(oldId, newId);
  return result;
}
