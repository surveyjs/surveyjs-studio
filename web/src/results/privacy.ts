import type { ElementsState } from "./elementsState";

/** A copy of the state whose every element is public unless its name is in `privateNames`. */
export function withPrivacy(state: ElementsState, privateNames: readonly string[]): ElementsState {
  return {
    ...state,
    elements: state.elements.map((element) => ({
      ...element,
      isPublic: !privateNames.includes(element.name),
    })),
  };
}

/**
 * The new list of private names after the dashboard changed its permissions: names of questions the
 * dashboard does not know (deleted ones) stay, in order, then the private ones in panel order.
 */
export function privateNamesOf(
  permissions: readonly { name: string; isPublic: boolean }[],
  previous: readonly string[],
): string[] {
  const known = new Set(permissions.map((permission) => permission.name));
  return [
    ...previous.filter((name) => !known.has(name)),
    ...permissions
      .filter((permission) => !permission.isPublic)
      .map((permission) => permission.name),
  ];
}
