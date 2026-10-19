import { getPublishedSurvey, type PublishedSurvey } from "../api/public";
import type { ClientIds } from "./clientId";
import { limitCookieOf } from "./definition";

/** What the run page needs to show a survey. */
export interface RunSurveyData {
  readonly survey: PublishedSurvey;
  /** The "Limit to one response" cookie name; null when the survey has no limit. */
  readonly limitCookie: string | null;
  /** Whether this browser's client id has already completed the survey (limit on only). */
  readonly completed: boolean;
}

/**
 * Loads a survey for the run page. The client id is sent only when the survey limits responses
 * and this browser already has one: a first read without it tells whether the limit is on, then
 * a second read with it tells whether this browser has completed the survey. A browser without
 * an id cannot have completed it, so it gets no id here (one is made on the first submit).
 */
export async function loadRunSurvey(
  surveyId: string,
  clientIds: ClientIds,
  signal?: AbortSignal,
): Promise<RunSurveyData> {
  const survey = await getPublishedSurvey(surveyId, undefined, signal);
  const limitCookie = limitCookieOf(survey.definition);
  const clientId = limitCookie === null ? null : clientIds.stored();
  if (clientId === null) return { survey, limitCookie, completed: false };
  const checked = await getPublishedSurvey(surveyId, clientId, signal);
  return { survey, limitCookie, completed: checked.completed === true };
}
