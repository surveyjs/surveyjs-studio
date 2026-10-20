import {
  PERSONAL_ACTIVE,
  PERSONAL_ARCHIVED,
  PROJECT_NAME,
  PROJECT_SURVEYS,
  type VisualScope,
} from "../data-set.js";

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];

function ordinal(index: number): string {
  return ORDINALS[index] ?? `#${index + 1}`;
}

/**
 * Compares the survey names a list shows with the data set's. One message per missing, extra or
 * misplaced name; an empty array means the lists are equal.
 */
export function compareNames(
  label: string,
  expected: readonly string[],
  found: readonly string[],
): string[] {
  const messages: string[] = [];
  for (const name of expected) {
    if (!found.includes(name)) messages.push(`${label}: missing "${name}"`);
  }
  for (const name of found) {
    if (!expected.includes(name)) messages.push(`${label}: unexpected "${name}"`);
  }
  if (messages.length > 0) return messages;
  expected.forEach((name, index) => {
    const actual = found[index];
    if (actual !== name) {
      messages.push(`${label}: expected "${name}" ${ordinal(index)}, found "${actual}"`);
    }
  });
  return messages;
}

/** The three list scopes of the data set, in display order. */
export function expectedScopes(): VisualScope[] {
  return [
    { label: "Personal active", names: [...PERSONAL_ACTIVE] },
    { label: "Personal archived", names: [...PERSONAL_ARCHIVED] },
    { label: `Project ${PROJECT_NAME}`, names: [...PROJECT_SURVEYS] },
  ];
}
