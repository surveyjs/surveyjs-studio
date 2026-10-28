import type { NewSurvey, SurveyChanges, SurveyOwner, SurveyRecord } from "./types.js";

const lowerId = (id: string): string => id.toLowerCase();

const lowerOwner = (owner: SurveyOwner): SurveyOwner =>
  owner.kind === "personal"
    ? { kind: "personal", userId: owner.userId.toLowerCase() }
    : { kind: "project", projectId: owner.projectId.toLowerCase() };

/** The record after `changes`; ids stay lower-case; `settings.useCookies` is never changed. */
export function applySurveyChanges(record: SurveyRecord, changes: SurveyChanges): SurveyRecord {
  const { name, move, published, archived, settings, updatedAt } = changes;
  return {
    ...structuredClone(record),
    ...(name !== undefined && { name }),
    ...(move !== undefined && {
      owner: lowerOwner(move.owner),
      creatorId: move.creatorId.toLowerCase(),
    }),
    ...(published !== undefined && { published }),
    ...(archived !== undefined && { archived }),
    settings: {
      ...record.settings,
      ...(settings?.publicResults !== undefined && { publicResults: settings.publicResults }),
      ...(settings?.storeRespondentIp !== undefined && {
        storeRespondentIp: settings.storeRespondentIp,
      }),
    },
    updatedAt,
  };
}

/**
 * A stored survey for a new one (create and clone): the legacy defaults (layout section 5.3) and
 * lower-case ids. Published, as the legacy store's empty flag reads (ADR 0014 S1).
 */
export const newSurveyRecord = (survey: NewSurvey): SurveyRecord => ({
  id: lowerId(survey.id),
  name: survey.name,
  owner: lowerOwner(survey.owner),
  creatorId: lowerId(survey.creatorId),
  postId: lowerId(survey.postId),
  resultId: lowerId(survey.resultId),
  published: true,
  archived: false,
  createdAt: survey.createdAt,
  updatedAt: survey.updatedAt,
  settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
});
