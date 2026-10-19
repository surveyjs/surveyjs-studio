import type { SurveyDefinition } from "../domain/types.js";

/** A question that holds an answer, as the CSV export and public results see it. */
export interface DefinitionQuestion {
  /** The question's `name`: its CSV header and its entry in the private-question list. */
  readonly name: string;
  /** Where its answer is in a response's data: `valueName` when set, else `name`. */
  readonly key: string;
  /** It has a comment or "other" area, stored under `key` + the comment suffix. */
  readonly hasComment: boolean;
}

/** Element types that hold no answer. */
const NO_VALUE = new Set(["html", "image"]);
const COMMENT_FLAGS = ["showCommentArea", "hasComment", "showOtherItem", "hasOther"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const elementsOf = (container: Record<string, unknown>): unknown[] => [
  ...(Array.isArray(container.elements) ? container.elements : []),
  ...(Array.isArray(container.questions) ? container.questions : []),
];

/** The comment suffix: `commentSuffix`, else the older `commentPrefix`, else the library's `-Comment`. */
export function commentSuffixOf(definition: SurveyDefinition): string {
  for (const property of ["commentSuffix", "commentPrefix"]) {
    const value = definition[property];
    if (typeof value === "string" && value !== "") return value;
  }
  return "-Comment";
}

/**
 * The questions that hold answers, in definition order: page by page (the root counts as one page when
 * there are no pages), panels flattened in place. Dynamic panels and matrices are one question each.
 * A name that repeats is listed once, where it first appears.
 */
export function questionsOf(definition: SurveyDefinition): DefinitionQuestion[] {
  const found: DefinitionQuestion[] = [];
  const seen = new Set<string>();
  const visit = (element: unknown): void => {
    if (!isRecord(element)) return;
    const type = typeof element.type === "string" ? element.type.toLowerCase() : "";
    if (type === "panel") {
      elementsOf(element).forEach(visit);
      return;
    }
    const { name, valueName } = element;
    if (typeof name !== "string" || name === "" || NO_VALUE.has(type) || seen.has(name)) return;
    seen.add(name);
    found.push({
      name,
      key: typeof valueName === "string" && valueName !== "" ? valueName : name,
      hasComment: COMMENT_FLAGS.some((flag) => element[flag] === true),
    });
  };
  const pages = Array.isArray(definition.pages) ? definition.pages : [definition];
  for (const page of pages) if (isRecord(page)) elementsOf(page).forEach(visit);
  return found;
}

/**
 * The data keys public results leave out for these private questions (R1): each name and, when the
 * definition gives the question a `valueName`, that key too, each without and with a comment suffix.
 * Every suffix counts (the current one, the library's `-Comment` and a set `commentPrefix`): older
 * responses keep the suffix they were stored with.
 */
export function privateKeysOf(
  definition: SurveyDefinition,
  privateNames: readonly string[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  if (privateNames.length === 0) return keys;
  const { commentPrefix } = definition;
  const suffixes = new Set([commentSuffixOf(definition), "-Comment"]);
  if (typeof commentPrefix === "string" && commentPrefix !== "") suffixes.add(commentPrefix);
  const keyOf = new Map(questionsOf(definition).map((question) => [question.name, question.key]));
  for (const name of privateNames) {
    for (const key of [name, keyOf.get(name) ?? name]) {
      keys.add(key);
      for (const suffix of suffixes) keys.add(key + suffix);
    }
  }
  return keys;
}

/** A copy of `data` without `keys` (the same object when there is nothing to remove). */
export function withoutKeys(
  data: Record<string, unknown>,
  keys: ReadonlySet<string>,
): Record<string, unknown> {
  if (keys.size === 0) return data;
  return Object.fromEntries(Object.entries(data).filter(([key]) => !keys.has(key)));
}
