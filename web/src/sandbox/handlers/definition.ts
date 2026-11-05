// Mirrors server/src/results/definition.ts: which data keys public results leave out for the
// survey's private questions. The sandbox code does not import server/src.
import { isRecord } from "./common";

type Definition = Record<string, unknown>;

interface DefinitionQuestion {
  readonly name: string;
  /** Where its answer is in a response's data: `valueName` when set, else `name`. */
  readonly key: string;
}

/** Element types that hold no answer. */
const NO_VALUE = new Set(["html", "image"]);

const elementsOf = (container: Record<string, unknown>): unknown[] => [
  ...(Array.isArray(container["elements"]) ? (container["elements"] as unknown[]) : []),
  ...(Array.isArray(container["questions"]) ? (container["questions"] as unknown[]) : []),
];

/** The comment suffix: `commentSuffix`, else the older `commentPrefix`, else the library's `-Comment`. */
function commentSuffixOf(definition: Definition): string {
  for (const property of ["commentSuffix", "commentPrefix"]) {
    const value = definition[property];
    if (typeof value === "string" && value !== "") return value;
  }
  return "-Comment";
}

/** The questions that hold answers, in definition order, panels flattened; a repeated name once. */
function questionsOf(definition: Definition): DefinitionQuestion[] {
  const found: DefinitionQuestion[] = [];
  const seen = new Set<string>();
  const visit = (element: unknown): void => {
    if (!isRecord(element)) return;
    const type = typeof element["type"] === "string" ? element["type"].toLowerCase() : "";
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
    });
  };
  const pages = Array.isArray(definition["pages"])
    ? (definition["pages"] as unknown[])
    : [definition];
  for (const page of pages) if (isRecord(page)) elementsOf(page).forEach(visit);
  return found;
}

/**
 * The data keys public results leave out for these private questions: each name and its
 * `valueName`, each without and with every comment suffix (the current, the library's, a
 * `commentPrefix`).
 */
export function privateKeysOf(
  definition: Definition,
  privateNames: readonly string[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  if (privateNames.length === 0) return keys;
  const commentPrefix = definition["commentPrefix"];
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

/** A copy of `data` without `keys`. */
export function withoutKeys(
  data: Record<string, unknown>,
  keys: ReadonlySet<string>,
): Record<string, unknown> {
  if (keys.size === 0) return data;
  return Object.fromEntries(Object.entries(data).filter(([key]) => !keys.has(key)));
}
