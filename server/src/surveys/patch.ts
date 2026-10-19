import type { components } from "@my-surveys/contract";
import type { SurveyChanges, SurveyOwner, SurveyRecord } from "../domain/types.js";

type SurveyPatch = components["schemas"]["SurveyPatch"];

const sameScope = (a: SurveyOwner, b: SurveyOwner): boolean =>
  a.kind === "personal"
    ? b.kind === "personal" && a.userId.toLowerCase() === b.userId.toLowerCase()
    : b.kind === "project" && a.projectId.toLowerCase() === b.projectId.toLowerCase();

/**
 * The record changes a validated patch asks for. `target` is the scope the service resolved from
 * `projectId` (the patch has the member), else undefined. A move to the current scope is no move.
 * Members the patch does not know are ignored; `updatedAt` is always set.
 */
export function surveyChangesFromPatch(
  survey: SurveyRecord,
  patch: SurveyPatch,
  context: { userId: string; target?: SurveyOwner; now: string },
): SurveyChanges {
  const { name, published, archived, settings } = patch;
  const { userId, target, now } = context;
  const changedSettings = {
    ...(settings?.publicResults !== undefined && { publicResults: settings.publicResults }),
    ...(settings?.storeRespondentIp !== undefined && {
      storeRespondentIp: settings.storeRespondentIp,
    }),
  };
  return {
    ...(name !== undefined && { name }),
    ...(target !== undefined &&
      !sameScope(target, survey.owner) && { move: { owner: target, creatorId: userId } }),
    ...(published !== undefined && { published }),
    ...(archived !== undefined && { archived }),
    ...(settings !== undefined && { settings: changedSettings }),
    updatedAt: now,
  };
}
