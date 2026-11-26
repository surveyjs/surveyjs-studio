import type { ResultsPrivacy, ViewStore } from "../providers/types.js";

/**
 * What the survey's public results leave out: the store's own rule where it has one (the old
 * stores, `ViewStore.getResultsPrivacy`), else its private-question list with any other key
 * public and nothing locked. Rejects when the store cannot read it, as `getPrivateQuestions`.
 */
export async function resultsPrivacyOf(
  views: ViewStore,
  surveyId: string,
): Promise<ResultsPrivacy> {
  if (views.getResultsPrivacy) return views.getResultsPrivacy(surveyId);
  return {
    privateQuestions: await views.getPrivateQuestions(surveyId),
    publicOnly: null,
    lockedQuestions: [],
  };
}
