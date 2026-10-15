import type { Project } from "../api/projects";
import type { Survey } from "../api/surveys";

/** What a menu item does; the labels are in `MENU_LABELS`. */
export type MenuItemId =
  | "run"
  | "edit"
  | "clone"
  | "publish"
  | "unpublish"
  | "ids"
  | "copy-id"
  | "copy-result-id"
  | "copy-post-id"
  | "results"
  | "history"
  | "delete"
  | "move"
  | "restore"
  | "archive";

/** The menu's texts (copied from the site). */
export const MENU_LABELS: Record<MenuItemId, string> = {
  run: "Run",
  edit: "Edit",
  clone: "Clone",
  publish: "Publish",
  unpublish: "Unpublish",
  ids: "Survey IDs",
  "copy-id": "Copy ID",
  "copy-result-id": "Copy Result ID",
  "copy-post-id": "Copy Post ID",
  results: "View Results",
  history: "View History",
  delete: "Delete",
  move: "Move to Project",
  restore: "Restore",
  archive: "Archive",
};

export const PERSONAL_SURVEYS_LABEL = "Personal Surveys";

export type CopyItemId = "copy-id" | "copy-result-id" | "copy-post-id";

/** An item without a flyout. */
export type ActionItemId = Exclude<MenuItemId, "ids" | "move" | CopyItemId>;

/**
 * One line of the menu: a separator, an action, "Survey IDs" with its three copy items, or "Move to
 * Project" (its entries come from `moveTargets`).
 */
export type MenuEntry =
  | { kind: "separator" }
  | { kind: "item"; id: ActionItemId }
  | { kind: "item"; id: "ids"; children: readonly CopyItemId[] }
  | { kind: "item"; id: "move" };

const COPY_ITEMS: readonly CopyItemId[] = ["copy-id", "copy-result-id", "copy-post-id"];

/** The menu of one survey row, in the site's order (see the assets README for the table). */
export function surveyMenuItems(
  survey: Survey,
  view: { archived: boolean; hasProjects: boolean },
): MenuEntry[] {
  const { archived, hasProjects } = view;
  const canModify = survey.permissions.canModify;
  const entries: MenuEntry[] = [];
  const action = (id: ActionItemId) => entries.push({ kind: "item", id });
  const separator = () => entries.push({ kind: "separator" });

  if (!archived && survey.published) action("run");
  if (!archived) action("edit");
  action("clone");
  if (canModify) separator();
  if (!archived && canModify) action(survey.published ? "unpublish" : "publish");
  if (!archived) {
    separator();
    entries.push({ kind: "item", id: "ids", children: COPY_ITEMS });
  }
  action("results");
  if (!archived) action("history");
  if (canModify) separator();
  if (archived && canModify) action("delete");
  if (!archived && canModify && hasProjects) entries.push({ kind: "item", id: "move" });
  if (archived && canModify) action("restore");
  if (!archived && canModify) action("archive");
  return entries;
}

/** One entry of the "Move to Project" flyout. */
export interface MoveTarget {
  readonly label: string;
  /** The project id, or `null` for the user's Personal surveys. */
  readonly target: string | null;
  /** The survey's current scope: marked, and not clickable. */
  readonly selected: boolean;
  readonly clickable: boolean;
}

/** "Personal Surveys", then the user's projects in the given order; the survey's own scope is inert. */
export function moveTargets(survey: Survey, projects: readonly Project[]): MoveTarget[] {
  const current = survey.projectId;
  return [
    {
      label: PERSONAL_SURVEYS_LABEL,
      target: null,
      selected: current === null,
      clickable: current !== null,
    },
    ...projects.map((project) => ({
      label: project.name,
      target: project.id,
      selected: project.id === current,
      clickable: project.id !== current,
    })),
  ];
}
