import type { SurveyDefinition, SurveyRecord } from "../domain/types.js";

/** The non-empty string `cookieName` of a definition, which switches "Limit to one response" on (S2). */
export function limitCookieOf(definition: SurveyDefinition): string | null {
  const { cookieName } = definition;
  return typeof cookieName === "string" && cookieName !== "" ? cookieName : null;
}

/**
 * The definition the run page gets: when the survey's legacy `useCookies` setting is on and the
 * definition names no cookie, a copy whose `cookieName` is the survey id. Otherwise unchanged.
 */
export function publishedDefinition(
  survey: SurveyRecord,
  definition: SurveyDefinition,
): SurveyDefinition {
  if (!survey.settings.useCookies || limitCookieOf(definition) !== null) return definition;
  return { ...definition, cookieName: survey.id };
}
