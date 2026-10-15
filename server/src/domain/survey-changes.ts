import type { SurveyChanges, SurveyOwner, SurveyRecord } from "./types.js";

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
