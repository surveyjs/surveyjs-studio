/** One item of a saved layout: a Summary chart or a Table column, keyed by its question name. */
export interface LayoutElement {
  name: string;
  [key: string]: unknown;
}
/** A saved layout of the Summary (Dashboard) or the Table: `elements` plus other members. */
export interface ElementsState {
  elements: LayoutElement[];
  [key: string]: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An older library wrote `displayname`; the current one reads `displayName`. */
function normalise(element: LayoutElement): LayoutElement {
  if (!("displayname" in element)) return element;
  const { displayname, ...rest } = element;
  return "displayName" in rest ? rest : { ...rest, displayName: displayname };
}

/**
 * Makes a saved Summary or Table state fit the survey as it is now: saved elements the survey still
 * has keep their saved order and settings, elements the saved state lacks (questions added after the
 * save) follow in default order, and elements the survey lost are dropped. Other saved members (the
 * locale, the page size) are kept. Null when `saved` is not such a state.
 */
export function reconcileElementsState(
  saved: unknown,
  defaults: ElementsState,
): ElementsState | null {
  if (!isRecord(saved) || !Array.isArray(saved.elements)) return null;
  const known = new Set(defaults.elements.map((element) => element.name));
  const kept = saved.elements
    .filter(
      (element): element is LayoutElement =>
        isRecord(element) && typeof element.name === "string" && known.has(element.name),
    )
    .map(normalise);
  const present = new Set(kept.map((element) => element.name));
  const added = defaults.elements.filter((element) => !present.has(element.name));
  return { ...saved, elements: [...kept, ...added] };
}

/** A copy of `state` without the elements named in `names` (the public Table's private columns). */
export function withoutElements(state: ElementsState, names: readonly string[]): ElementsState {
  return { ...state, elements: state.elements.filter((element) => !names.includes(element.name)) };
}
