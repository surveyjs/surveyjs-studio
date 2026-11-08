// The default names of a new survey and of a clone, as server/src/surveys/naming.ts.

const PREFIX = "New Survey";
/** The legacy parser's white space, an optional sign and digits. */
const NUMBER = /^[\t\n\v\f\r ]*[+-]?[0-9]+[\t\n\v\f\r ]*$/;
/** Larger numbers do not count: the legacy parser reads 32-bit integers. */
const MAX_NUMBER = 2147483647;

/**
 * "New Survey N", where N is one more than the highest number among the given names of the form
 * "New Survey N". Gaps are not filled. Callers pass the names of the scope's active surveys.
 */
export function nextNewSurveyName(names: readonly string[]): string {
  let next = 1;
  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue;
    const suffix = name.slice(PREFIX.length);
    if (!NUMBER.test(suffix)) continue;
    const value = Number(suffix.trim());
    if (value <= MAX_NUMBER && value >= next) next = value + 1;
  }
  return `${PREFIX} ${next}`;
}

const COPY_PREFIX = "Copy of ";
/** Legacy `Surveys.name` is nvarchar(200): 200 UTF-16 code units. */
export const MAX_NAME_UNITS = 200;

/** "Copy of " and the source name, cut to 200 UTF-16 code units without splitting a surrogate pair. */
export function cloneName(sourceName: string): string {
  const name = COPY_PREFIX + sourceName;
  if (name.length <= MAX_NAME_UNITS) return name;
  const last = name.charCodeAt(MAX_NAME_UNITS - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? MAX_NAME_UNITS - 1 : MAX_NAME_UNITS;
  return name.slice(0, end);
}
