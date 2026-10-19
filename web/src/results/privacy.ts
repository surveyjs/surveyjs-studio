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

/** What the Summary changed: the names it made private and the names it made public. */
export interface PrivacyChange {
  readonly madePrivate: readonly string[];
  readonly madePublic: readonly string[];
}

export const NO_PRIVACY_CHANGE: PrivacyChange = { madePrivate: [], madePublic: [] };

export const isNoPrivacyChange = (change: PrivacyChange): boolean =>
  change.madePrivate.length === 0 && change.madePublic.length === 0;

/**
 * `names` with the change applied: the names made public removed, the names made private appended
 * (once), every other name kept in place. Saves apply a change to a fresh read of the list, so a
 * name someone else changed meanwhile is left as they saved it.
 */
export function applyPrivacyChange(names: readonly string[], change: PrivacyChange): string[] {
  const kept = names.filter((name) => !change.madePublic.includes(name));
  for (const name of change.madePrivate) if (!kept.includes(name)) kept.push(name);
  return kept;
}

/** One change that does `older`, then `newer`: for a name both touch, `newer` wins. */
export function combinePrivacyChanges(older: PrivacyChange, newer: PrivacyChange): PrivacyChange {
  const touched = (name: string) =>
    newer.madePrivate.includes(name) || newer.madePublic.includes(name);
  return {
    madePrivate: [...older.madePrivate.filter((name) => !touched(name)), ...newer.madePrivate],
    madePublic: [...older.madePublic.filter((name) => !touched(name)), ...newer.madePublic],
  };
}

/**
 * The privacy of one Summary session: it starts as the survey setting, and each permissions change
 * of the dashboard is turned into the names whose `isPublic` flipped. A private question the
 * dashboard no longer lists (a hidden chart) is in no change, so it stays private.
 */
export function createPrivacyTracker(initial: readonly string[]): {
  /** The names whose privacy differs from the latest list; that list then follows them. */
  change(permissions: readonly { name: string; isPublic: boolean }[]): PrivacyChange;
  /** The setting at mount with every change of this session applied. */
  current(): readonly string[];
} {
  let latest: readonly string[] = [...initial];
  return {
    change(permissions) {
      const change: PrivacyChange = {
        madePrivate: permissions
          .filter((permission) => !permission.isPublic && !latest.includes(permission.name))
          .map((permission) => permission.name),
        madePublic: permissions
          .filter((permission) => permission.isPublic && latest.includes(permission.name))
          .map((permission) => permission.name),
      };
      latest = applyPrivacyChange(latest, change);
      return change;
    },
    current: () => latest,
  };
}
