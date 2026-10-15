/**
 * The default name of a survey created without one, as on surveyjs.io: "New Survey N", where N is
 * one more than the highest number among the given names of the form "New Survey N". Gaps are not
 * filled. Callers pass the names of the active surveys of the target scope.
 */

const PREFIX = "New Survey";
/** The legacy parser's white space, an optional sign and digits. */
const NUMBER = /^[\t\n\v\f\r ]*[+-]?[0-9]+[\t\n\v\f\r ]*$/;
/** Larger numbers do not count: the legacy parser reads 32-bit integers. */
const MAX_NUMBER = 2147483647;

export function nextNewSurveyName(names: readonly string[]): string {
  let next = 1;
  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue;
    const suffix = name.slice(PREFIX.length);
    if (!NUMBER.test(suffix)) continue;
    // Digits only (with a sign), so Number is exact up to far beyond the 32-bit range.
    const value = Number(suffix.trim());
    if (value <= MAX_NUMBER && value >= next) next = value + 1;
  }
  return `${PREFIX} ${next}`;
}

const COPY_PREFIX = "Copy of ";
/** Legacy `Surveys.name` is nvarchar(200): 200 UTF-16 code units. */
const MAX_NAME_UNITS = 200;

/**
 * The default name of a clone: "Copy of " and the source name, cut to 200 UTF-16 code units
 * without splitting a surrogate pair.
 */
export function cloneName(sourceName: string): string {
  const name = COPY_PREFIX + sourceName;
  if (name.length <= MAX_NAME_UNITS) return name;
  const last = name.charCodeAt(MAX_NAME_UNITS - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? MAX_NAME_UNITS - 1 : MAX_NAME_UNITS;
  return name.slice(0, end);
}
