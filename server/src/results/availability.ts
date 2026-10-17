import type { SurveyRecord } from "../domain/types.js";
import { AppError } from "../errors.js";
import type { SurveyStore } from "../providers/types.js";

/** The 404 of every public operation: an unknown and an unpublished survey look the same (S1). */
export function surveyNotAvailable(): AppError {
  return new AppError({
    code: "survey-not-available",
    status: 404,
    title: "This survey is not available",
  });
}

/** The survey when it exists and is published (archived or not); `survey-not-available` otherwise. */
export async function availableSurvey(
  surveys: SurveyStore,
  surveyId: string,
): Promise<SurveyRecord> {
  const survey = await surveys.getSurvey(surveyId);
  if (!survey?.published) throw surveyNotAvailable();
  return survey;
}
