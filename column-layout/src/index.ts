// The old results column layout's visibility rules, shared by the bridge (which merges the layout
// into the columns the old API answered) and the server's migration tool (which turns the layout
// into the survey's private questions). Pure: it reads a layout already parsed by the caller.

/** `Visibility`: shown; hidden; hidden from public reads only. */
export const VISIBLE = 0;
export const PUBLIC_INVISIBLE = 2;

/** How a caller's parsed values differ from plain JSON (the bridge's lenient reader). */
export interface LayoutValues {
  /** Whether a value is an object a column can be (default: a plain object, not an array). */
  isObject?(value: unknown): value is Record<string, unknown>;
  /** Whether a text is one the old reader made a date of (default: none). */
  isDateText?(text: string): boolean;
}

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A stored `visibility` or `location` as the old read took it: none is 0, a text is its integer
 * (any other text 0), a whole number as it is; `undefined` for anything else (the old read failed).
 */
export function enumValue(value: unknown): number | undefined {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") {
    const match = /^[\t-\r ]*([+-]?[0-9]+)[\t-\r ]*$/.exec(value);
    const number = match === null ? Number.NaN : Number(match[1]);
    return Number.isNaN(number) || Math.abs(number) > 2_147_483_647 ? 0 : number;
  }
  if (typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= 2_147_483_647) {
    return value;
  }
  return undefined;
}

/** Why a layout's `columns` cannot be read; the old calculation failed on it. */
export type StoredColumnsFault = "entry-no-object" | "text" | "object";

/**
 * The layout's `columns` as the old reader took them: a list of objects (or nulls), or none (`[]`).
 * A fault (a column that is no object, or a text or object that is not empty) is returned as its
 * name, where the old calculation failed.
 */
export function storedColumnEntries(
  value: unknown,
  values: LayoutValues = {},
): (Record<string, unknown> | null)[] | StoredColumnsFault {
  const isObject = values.isObject ?? isPlainObject;
  if (Array.isArray(value)) {
    const entries: (Record<string, unknown> | null)[] = [];
    for (const entry of value as unknown[]) {
      if (entry === null) entries.push(null);
      else if (isObject(entry)) entries.push(entry);
      else return "entry-no-object";
    }
    return entries;
  }
  if (typeof value === "string" && value !== "" && !values.isDateText?.(value)) return "text";
  if (isObject(value) && Object.keys(value).length > 0) return "object";
  return [];
}

/** The columns the old results hid from public reads; HappendAt and InstanceId are named here. */
const TIME_AND_ID = ["HappendAt", "InstanceId"] as const;

/**
 * The names of the answers (and `HappendAt` and `InstanceId`) a layout keeps out of public results,
 * as the old calculation merged it, among `answerNames` (every answer name the survey can hold):
 * - a column the layout lists is private unless its `visibility` is shown;
 * - when the layout lists at least one column, an answer it does not list takes the layout's
 *   `newcolumnsvisibility` (so it is private unless that is shown), and `HappendAt` and
 *   `InstanceId` it does not list are private;
 * - a layout listing no columns hides nothing.
 * Returns `null` when the layout cannot be read (the old calculation failed): not an object, a
 * column of a type the old reader failed on, or a visibility that is no number. A listed column's
 * name that is none of the answers still counts (a response may hold it later). Every name the
 * layout hides is listed, `id` or `IPAddress` too: a question may carry such a name, and listing
 * a column the public results never show anyway does no harm.
 */
export function privateNamesOfLayout(
  layout: unknown,
  answerNames: Iterable<string>,
  values: LayoutValues = {},
): string[] | null {
  const isObject = values.isObject ?? isPlainObject;
  if (!isObject(layout)) return null;
  const entries = storedColumnEntries(layout.columns, values);
  if (typeof entries === "string") return null;
  const newColumns = enumValue(layout.newcolumnsvisibility);
  if (newColumns === undefined) return null;
  if (entries.length === 0) return [];

  const listed = new Map<string, number>();
  for (const entry of entries) {
    if (entry === null) continue;
    const visibility = enumValue(entry.visibility);
    if (visibility === undefined) return null;
    const { name } = entry;
    if (typeof name === "string" && name !== "" && !listed.has(name)) listed.set(name, visibility);
  }

  const names = new Set<string>();
  for (const [name, visibility] of listed) if (visibility !== VISIBLE) names.add(name);
  for (const name of answerNames) {
    if (!listed.has(name) && newColumns !== VISIBLE) names.add(name);
  }
  for (const name of TIME_AND_ID) if (!listed.has(name)) names.add(name);
  return [...names];
}
