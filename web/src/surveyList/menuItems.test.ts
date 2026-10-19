import { describe, expect, it } from "vitest";
import type { Project } from "../api/projects";
import type { Survey } from "../api/surveys";
import { sampleProject, sampleSurvey } from "../test/server";
import { MENU_LABELS, moveTargets, surveyMenuItems, type MenuEntry } from "./menuItems";

const survey = (changes: Partial<Survey>, canModify = true): Survey => ({
  ...sampleSurvey,
  ...changes,
  permissions: { canModify },
});

/** The menu as text: labels, "—" for a separator, children after ">". */
function text(entries: MenuEntry[]): string[] {
  return entries.map((entry) => {
    if (entry.kind === "separator") return "—";
    const label = MENU_LABELS[entry.id];
    return "children" in entry
      ? `${label} > ${entry.children.map((id) => MENU_LABELS[id]).join(", ")}`
      : label;
  });
}

const active = { archived: false, hasProjects: true };
const archived = { archived: true, hasProjects: true };
const ids = "Survey IDs > Copy ID, Copy Result ID, Copy Post ID";

describe("surveyMenuItems", () => {
  it("Active, can modify, unpublished", () => {
    expect(text(surveyMenuItems(survey({}), active))).toEqual([
      "Edit",
      "Clone",
      "—",
      "Publish",
      "—",
      ids,
      "View Results",
      "View History",
      "—",
      "Move to Project",
      "Archive",
    ]);
  });

  it("Active, can modify, published", () => {
    expect(text(surveyMenuItems(survey({ published: true }), active))).toEqual([
      "Run",
      "Edit",
      "Clone",
      "—",
      "Unpublish",
      "—",
      ids,
      "View Results",
      "View History",
      "—",
      "Move to Project",
      "Archive",
    ]);
  });

  it("Active, cannot modify", () => {
    expect(text(surveyMenuItems(survey({}, false), active))).toEqual([
      "Edit",
      "Clone",
      "—",
      ids,
      "View Results",
      "View History",
    ]);
    expect(text(surveyMenuItems(survey({ published: true }, false), active))).toEqual([
      "Run",
      "Edit",
      "Clone",
      "—",
      ids,
      "View Results",
      "View History",
    ]);
  });

  it("Archived, can modify (published or not)", () => {
    const expected = ["Clone", "—", "View Results", "—", "Delete", "Restore"];
    expect(text(surveyMenuItems(survey({ archived: true }), archived))).toEqual(expected);
    expect(text(surveyMenuItems(survey({ archived: true, published: true }), archived))).toEqual(
      expected,
    );
  });

  it("Archived, cannot modify", () => {
    expect(text(surveyMenuItems(survey({ archived: true }, false), archived))).toEqual([
      "Clone",
      "View Results",
    ]);
  });

  it("leaves out Move to Project without projects", () => {
    const entries = surveyMenuItems(survey({}), { archived: false, hasProjects: false });
    expect(text(entries)).not.toContain("Move to Project");
    expect(text(entries).at(-1)).toBe("Archive");
  });
});

describe("moveTargets", () => {
  const sales: Project = {
    ...sampleProject,
    id: "55555555-0000-4000-8000-a00000000002",
    name: "Sales",
  };
  const projects = [sampleProject, sales];

  it("in the Personal scope: Personal selected and inert, projects clickable", () => {
    expect(moveTargets(survey({ projectId: null }), projects)).toEqual([
      { label: "Personal Surveys", target: null, selected: true, clickable: false },
      { label: "Marketing", target: sampleProject.id, selected: false, clickable: true },
      { label: "Sales", target: sales.id, selected: false, clickable: true },
    ]);
  });

  it("in a project scope: Personal clickable, the project selected and inert", () => {
    expect(moveTargets(survey({ projectId: sales.id }), projects)).toEqual([
      { label: "Personal Surveys", target: null, selected: false, clickable: true },
      { label: "Marketing", target: sampleProject.id, selected: false, clickable: true },
      { label: "Sales", target: sales.id, selected: true, clickable: false },
    ]);
  });
});
