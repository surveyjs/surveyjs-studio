export interface TableElement {
  name: string;
  [key: string]: unknown;
}
export interface TableState {
  elements: TableElement[];
  [key: string]: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An older library wrote `displayname`; the current one reads `displayName`. */
function normalise(element: TableElement): TableElement {
  if (!("displayname" in element)) return element;
  const { displayname, ...rest } = element;
  return "displayName" in rest ? rest : { ...rest, displayName: displayname };
}

/**
 * Makes a saved table state fit the survey as it is now: saved columns the survey still has keep
 * their saved order and settings, columns the saved state lacks follow in default order, and
 * columns the survey lost are dropped. Null when `saved` is not a table state.
 */
export function reconcileTableState(saved: unknown, defaults: TableState): TableState | null {
  if (!isRecord(saved) || !Array.isArray(saved.elements)) return null;
  const known = new Set(defaults.elements.map((element) => element.name));
  const kept = saved.elements
    .filter(
      (element): element is TableElement =>
        isRecord(element) && typeof element.name === "string" && known.has(element.name),
    )
    .map(normalise);
  const present = new Set(kept.map((element) => element.name));
  const added = defaults.elements.filter((element) => !present.has(element.name));
  return { ...saved, elements: [...kept, ...added] };
}
