import type { components } from "@surveyjs-studio/contract";
import type { SurveyRecord } from "../domain/types.js";
import type { ResultsPrivacy } from "../providers/types.js";

export type SurveyJson = components["schemas"]["Survey"];

/**
 * The contract `Survey` of a record, with the private-question list when given (a list, or what
 * the store's rule reads: its locked questions as `lockedPrivateResultQuestions` when any).
 */
export function surveyJson(
  survey: SurveyRecord,
  canModify: boolean,
  privacy?: readonly string[] | Pick<ResultsPrivacy, "privateQuestions" | "lockedQuestions">,
): SurveyJson {
  const { privateQuestions, lockedQuestions = [] } =
    privacy === undefined || isList(privacy) ? { privateQuestions: privacy } : privacy;
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
    legacyPublishId: survey.legacyPublishId,
    settings: {
      publicResults: survey.settings.publicResults,
      storeRespondentIp: survey.settings.storeRespondentIp,
      useCookies: survey.settings.useCookies,
      ...(privateQuestions && { privateResultQuestions: [...privateQuestions] }),
      ...(privateQuestions &&
        lockedQuestions.length > 0 && { lockedPrivateResultQuestions: [...lockedQuestions] }),
    },
  };
}

const isList = (value: unknown): value is readonly string[] => Array.isArray(value);
