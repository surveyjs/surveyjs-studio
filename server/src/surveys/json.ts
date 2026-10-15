import type { components } from "@my-surveys/contract";
import type { SurveyRecord } from "../domain/types.js";

export type SurveyJson = components["schemas"]["Survey"];

/** The contract `Survey` of a record (`useCookies` is not exposed). */
export function surveyJson(survey: SurveyRecord, canModify: boolean): SurveyJson {
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
    settings: {
      publicResults: survey.settings.publicResults,
      storeRespondentIp: survey.settings.storeRespondentIp,
    },
  };
}
