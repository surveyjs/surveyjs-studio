import type { components } from "@surveyjs-studio/contract";
import type { SurveyRecord } from "../domain/types.js";

export type SurveyJson = components["schemas"]["Survey"];

/** The contract `Survey` of a record. */
export function surveyJson(
  survey: SurveyRecord,
  canModify: boolean,
  privateResultQuestions?: readonly string[],
): SurveyJson {
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
    permissions: { canModify },
    useCookies: survey.settings.useCookies,
    creatorId: survey.creatorId,
    legacyPublishId: null,
    settings: {
      publicResults: survey.settings.publicResults,
      storeRespondentIp: survey.settings.storeRespondentIp,
      useCookies: survey.settings.useCookies,
      ...(privateResultQuestions && { privateResultQuestions: [...privateResultQuestions] }),
    },
  };
}
