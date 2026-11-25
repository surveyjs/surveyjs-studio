/**
 * The answer columns a legacy shared column layout (`columns` kind) marks hidden or not public.
 * A stored column is public only when its `visibility` is 0 (shown); the old API's `visibility`
 * is read as the bridge reads it (bridge/src/columns.ts `enumValue`): none is 0, a text is its
 * integer (any other text 0), a whole number as it is. A `visibility` of any other type is a
 * layout the old calculation failed on, so the layout is unreadable.
 *
 * Only the layout's own columns can be named here; `newcolumnsvisibility` applies to columns the
 * responses add later and names none.
 */

/** Columns the bridge computes by itself (time, IP, client and id); they need no rule here. */
const SYSTEM_COLUMNS = new Set(["happendat", "instanceid", "ipaddress", "clientid", "id"]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `undefined` when the value is of a type the old reader failed on. */
function visibilityOf(value: unknown): number | undefined {
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

/**
 * The names of the layout's answer columns that are hidden or not public, in layout order, each
 * once; null when the text is not a JSON object (one leading byte-order mark is removed) or a
 * column cannot be read.
 */
export function hiddenAnswerColumns(text: string): string[] | null {
  let layout: unknown;
  try {
    layout = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return null;
  }
  if (!isObject(layout)) return null;
  const columns = layout.columns;
  if (columns === undefined || columns === null) return [];
  if (!Array.isArray(columns)) return null;
  const names: string[] = [];
  for (const column of columns as unknown[]) {
    if (column === null) continue;
    if (!isObject(column)) return null;
    const visibility = visibilityOf(column.visibility);
    if (visibility === undefined) return null;
    const { name } = column;
    if (
      visibility !== 0 &&
      typeof name === "string" &&
      name !== "" &&
      !SYSTEM_COLUMNS.has(name.toLowerCase()) &&
      !names.includes(name)
    ) {
      names.push(name);
    }
  }
  return names;
}
