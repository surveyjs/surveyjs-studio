import { validateSurveyListSearch } from "./search";

// The list the user looked at last, `personal` or a project id, so that `/` opens it again, as
// surveyjs.io does with its `organizationId` cookie. It is kept in localStorage for each user (so
// two people who share a browser do not get each other's project) until the user looks at another
// list; unlike the site's cookie, it does not expire. Storage can be missing or throw (private
// windows, blocked site data): then nothing is remembered and `/` opens Personal Surveys.

export const LAST_PROJECT_KEY_PREFIX = "my-surveys.last-project.";

/** The list `userId` looked at last, or null when none is stored or the stored value is not valid. */
export function lastProject(
  userId: string,
  storage: () => Storage = () => window.localStorage,
): string | null {
  try {
    const stored = storage().getItem(LAST_PROJECT_KEY_PREFIX + userId);
    return stored === null ? null : (validateSurveyListSearch({ project: stored }).project ?? null);
  } catch {
    return null;
  }
}

/** Remembers the list `userId` is looking at. */
export function rememberProject(
  userId: string,
  project: string,
  storage: () => Storage = () => window.localStorage,
): void {
  try {
    storage().setItem(LAST_PROJECT_KEY_PREFIX + userId, project);
  } catch {
    // Not remembered; `/` opens Personal Surveys next time.
  }
}
