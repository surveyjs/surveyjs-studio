export type BaselinesMode = "live" | "self";

/** The baselines root from the repository root: the live site's, or the git-ignored `--self` check's. */
export function baselinesRoot(mode: BaselinesMode): string {
  return mode === "live" ? "e2e/visual/baselines" : "e2e/visual/.self-baselines";
}

/**
 * Where Playwright writes and reads the baselines of a mode. Both configs' test directories sit at
 * `e2e/visual/<dir>`, so three levels up from `{testDir}` is the repository root.
 */
export function snapshotPathTemplate(mode: BaselinesMode): string {
  return `{testDir}/../../../${baselinesRoot(mode)}/{platform}/{projectName}/{arg}{ext}`;
}

/** The live site's baselines: the capture writes them, `pnpm e2e:visual` reads them. */
export const SNAPSHOT_PATH_TEMPLATE = snapshotPathTemplate("live");

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
