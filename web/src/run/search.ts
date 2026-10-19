// The run page's URL search (`/s/$surveyId?locale=de&q1=Ann`), as the surveyjs.io run page reads
// its query string: `locale` sets the survey's language, every other member prefills an answer.

/** The search as the router parsed it: its default parser already JSON-parses each value. */
export type RunSearch = Record<string, unknown>;

/** Members that are not answers: `id` is the legacy `/published?id=` survey id. */
const NOT_ANSWERS = new Set(["id", "locale"]);

/** Keeps every member as given (a shallow copy): any of them may be an answer. */
export function validateRunSearch(raw: Record<string, unknown>): RunSearch {
  return { ...raw };
}

/** The survey locale asked for (`?locale=`), trimmed; undefined when absent, empty or not text. */
export function localeOf(search: RunSearch): string | undefined {
  const { locale } = search;
  if (typeof locale !== "string") return undefined;
  const trimmed = locale.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Whether the Form Library's translations must be loaded for `locale` (English is built in). */
export function needsLocales(locale: string | undefined): boolean {
  return locale !== undefined && locale.toLowerCase() !== "en";
}

/** The answers to prefill: every member except `id` and `locale`, in URL order. */
export function prefillValues(search: RunSearch): [string, unknown][] {
  return Object.entries(search).filter(([name]) => !NOT_ANSWERS.has(name));
}
