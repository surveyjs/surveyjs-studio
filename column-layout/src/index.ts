// The old results column layout's visibility rules, shared by the bridge (which merges the layout
// into the columns the old API answered) and the server (which turns the layout and the old
// permissions list into the survey's private questions, `privateAnswers`). Pure: it reads values
// already parsed by the caller.

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

/** A layout as the old calculation read it: the names it lists, and its new-columns visibility. */
interface ReadLayout {
  /** Each listed name (first occurrence) with its visibility. */
  listed: Map<string, number>;
  /** Whether the layout lists at least one column (a nameless one counts). */
  hasColumns: boolean;
  newColumns: number;
}

/** The layout read as the old calculation read it; null where it failed. */
function readLayout(layout: unknown, values: LayoutValues): ReadLayout | null {
  const isObject = values.isObject ?? isPlainObject;
  if (!isObject(layout)) return null;
  const entries = storedColumnEntries(layout.columns, values);
  if (typeof entries === "string") return null;
  const newColumns = enumValue(layout.newcolumnsvisibility);
  if (newColumns === undefined) return null;
  const listed = new Map<string, number>();
  for (const entry of entries) {
    if (entry === null) continue;
    const visibility = enumValue(entry.visibility);
    if (visibility === undefined) return null;
    const { name } = entry;
    if (typeof name === "string" && name !== "" && !listed.has(name)) listed.set(name, visibility);
  }
  return { listed, hasColumns: entries.length > 0, newColumns };
}

/** The layout rule on a layout already read (see `privateNamesOfLayout`). */
function layoutRule({ listed, hasColumns, newColumns }: ReadLayout, answerNames: Iterable<string>) {
  if (!hasColumns) return [];
  const names = new Set<string>();
  for (const [name, visibility] of listed) if (visibility !== VISIBLE) names.add(name);
  for (const name of answerNames) {
    if (!listed.has(name) && newColumns !== VISIBLE) names.add(name);
  }
  for (const name of TIME_AND_ID) if (!listed.has(name)) names.add(name);
  return [...names];
}

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
  const read = readLayout(layout, values);
  return read === null ? null : layoutRule(read, answerNames);
}

/** What a survey's two old settings keep out of its public results (`privateAnswers`). */
export interface PrivateAnswers {
  /** The names kept out of public results, each once. */
  privateNames: string[];
  /** The answer names, `HappendAt` and `InstanceId` among them, that stay public. */
  publicNames: string[];
  /**
   * With both settings (a layout listing columns and a permissions list): the names the layout
   * lists, the only ones a permission entry can make public. Any other name, an answer added
   * later included, is private whatever the list says. Null when the settings are not both there.
   */
  listedUnderPermissions: ReadonlySet<string> | null;
}

/** The permission entries' names with `isPublic` exactly `true`, and exactly `false`. */
function permissionNames(permissions: readonly unknown[]) {
  const publicNames = new Set<string>();
  const privateNames = new Set<string>();
  for (const element of permissions) {
    if (!isPlainObject(element)) continue;
    const { name, isPublic } = element;
    if (typeof name !== "string" || name === "") continue;
    if (isPublic === true) publicNames.add(name);
    else if (isPublic === false) privateNames.add(name);
  }
  return { publicNames, privateNames };
}

/**
 * The privacy rule of the old public results, from the survey's permissions list (its parsed
 * `[{name, isPublic}]`; `undefined`: no list) and its results column layout (parsed; `undefined`:
 * no layout), among `answerNames` (the definition's question names and the responses' keys;
 * `HappendAt` and `InstanceId` are added):
 * 1. no layout, or one listing no columns: the list's entries with `isPublic: false` are private;
 * 2. a layout listing columns and no list: the layout rule (`privateNamesOfLayout`);
 * 3. both: only a name the list marks `isPublic: true` (and no entry marks `false`) that the
 *    layout also lists, at any visibility, stays public; every other name is private, an answer
 *    added later, a response-only key, `HappendAt` and `InstanceId` too. Literally for every list:
 *    one of private entries only leaves no public answer. The names the layout lists and the
 *    list's names are kept private too when not public (a response may hold them later).
 * Null when the layout cannot be read (the old calculation failed); the caller decides whether the
 * list can (it must be a JSON array). The same inputs give the same order.
 */
export function privateAnswers(
  permissions: readonly unknown[] | undefined,
  layout: unknown,
  answerNames: Iterable<string>,
  values: LayoutValues = {},
): PrivateAnswers | null {
  const read = layout === undefined ? undefined : readLayout(layout, values);
  if (read === null) return null;
  const answers = [...new Set([...answerNames, ...TIME_AND_ID])];
  let privateNames: string[];
  let listedUnderPermissions: ReadonlySet<string> | null = null;
  if (permissions === undefined) {
    privateNames = read === undefined ? [] : layoutRule(read, answers);
  } else if (read === undefined || !read.hasColumns) {
    privateNames = [...permissionNames(permissions).privateNames];
  } else {
    const marked = permissionNames(permissions);
    const listed = new Set(read.listed.keys());
    const isPublic = (name: string) =>
      marked.publicNames.has(name) && !marked.privateNames.has(name) && listed.has(name);
    const named = new Set([...answers, ...listed, ...marked.publicNames, ...marked.privateNames]);
    privateNames = [...named].filter((name) => !isPublic(name));
    listedUnderPermissions = listed;
  }
  const hidden = new Set(privateNames);
  return {
    privateNames,
    publicNames: answers.filter((name) => !hidden.has(name)),
    listedUnderPermissions,
  };
}
