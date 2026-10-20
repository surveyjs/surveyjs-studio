/** Where Playwright writes and reads the baselines (both configs), relative to the test directory. */
export const SNAPSHOT_PATH_TEMPLATE = "{testDir}/../baselines/{platform}/{projectName}/{arg}{ext}";

/** The baselines root from the repository root: the live site's, or the git-ignored `--self` check's. */
export function baselinesRoot(mode: "live" | "self"): string {
  return mode === "live" ? "e2e/visual/baselines" : "e2e/visual/.self-baselines";
}

/** The file the capture writes its states to (the live baselines root). */
export function statesFile(): string {
  return `${baselinesRoot("live")}/states.json`;
}

export type VisualIds = Partial<Record<"feedbackId" | "feedbackResultId" | "projectId", string>>;

/** Fills `{feedbackId}`, `{feedbackResultId}` and `{projectId}`; a placeholder without an id throws. */
export function resolvePath(path: string, ids: VisualIds): string {
  return path.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const id = Object.hasOwn(ids, name) ? ids[name as keyof VisualIds] : undefined;
    if (id === undefined || id === "") throw new Error(`Unknown placeholder {${name}} in ${path}`);
    return id;
  });
}
