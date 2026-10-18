/**
 * The definition without the questions named in `names`, in pages, panels and the top-level
 * `elements`. The Table cannot hide a column for good: a column missing from its state is built
 * again and the column chooser offers every column, so the public Table is built from a survey
 * that does not have the private questions at all.
 */
export function withoutQuestions<T extends object>(definition: T, names: readonly string[]): T {
  if (names.length === 0) return definition;
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (node === null || typeof node !== "object") return node;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      result[key] =
        key === "elements" && Array.isArray(value)
          ? value
              .filter((element) => !names.includes((element as { name?: string }).name ?? ""))
              .map(clean)
          : key === "pages"
            ? clean(value)
            : value;
    }
    return result;
  };
  return clean(definition) as T;
}
