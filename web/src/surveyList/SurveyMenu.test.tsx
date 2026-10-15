import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Project } from "../api/projects";
import type { Survey } from "../api/surveys";
import { renderApp } from "../test/renderApp";
import {
  cloneSurveyHandler,
  configHandler,
  deleteSurveyHandler,
  meHandler,
  projectsHandler,
  sampleProject,
  sampleSurvey,
  server,
  surveyActionProblemHandler,
  surveysHandler,
  updateSurveyHandler,
} from "../test/server";
import { MENU_LABELS, surveyMenuItems } from "./menuItems";

const marketing = sampleProject;
const engineering: Project = {
  ...sampleProject,
  id: "55555555-0000-4000-8000-a00000000002",
  name: "Engineering",
  role: "user",
};
const other: Survey = {
  ...sampleSurvey,
  id: "11111111-0000-4000-8000-000000000002",
  name: "Team retro",
  postId: "11111111-0000-4000-8000-0000000000a2",
  resultId: "11111111-0000-4000-8000-0000000000b2",
};

const MOVE_TEXT =
  "Do you want to move this survey to another organization? This operation can't be undone.";
const DELETE_TEXT = "Do you really want to delete this survey? This operation can't be undone.";

const writeText = vi.fn<(text: string) => Promise<void>>();
let confirm: MockInstance<Window["confirm"]>;

beforeEach(() => {
  confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

/** Renders My Surveys at `path` with `surveys` and the user's `projects`; waits for the list. */
async function renderList(path: string, surveys: Survey[], projects: Project[] = []) {
  server.use(
    configHandler(),
    meHandler(),
    surveysHandler({ "": { items: surveys, nextCursor: null } }),
    projectsHandler({ "": { items: projects, nextCursor: null } }),
  );
  const router = renderApp(path);
  await screen.findByText(surveys[0]?.name ?? "");
  return router;
}

function row(name: string) {
  const element = screen.getByText(name, { selector: ".v2-class---my-surveys-page__survey-name" });
  return element.closest<HTMLElement>(".v2-class---my-surveys-page__list-item")!;
}

const trigger = (name: string) => within(row(name)).getByRole("button", { name: "Survey actions" });

const popup = (name: string) =>
  row(name).querySelector<HTMLElement>(".v2-class---drop-down-button > .v2-class---drop-down-menu");

function openMenu(name: string) {
  fireEvent.click(trigger(name));
  return within(popup(name)!);
}

/** The top-level entries of the open menu: item texts, "—" for a separator. */
function menuTexts(name: string) {
  const items = popup(name)!.querySelectorAll(":scope > ul > li");
  return Array.from(items, (item) =>
    item.classList.contains("v2-class---drop-down-menu-item--separator")
      ? "—"
      : item.querySelector(".v2-class---drop-down-menu-item__text")!.textContent,
  );
}

const expectedTexts = (survey: Survey, view: { archived: boolean; hasProjects: boolean }) =>
  surveyMenuItems(survey, view).map((entry) =>
    entry.kind === "separator" ? "—" : MENU_LABELS[entry.id],
  );

/** Lets a request that should not be sent have the chance to be sent. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("the row menu", () => {
  it("opens and closes with a click on the dots, marking the row while open", async () => {
    await renderList("/", [sampleSurvey]);
    const button = trigger("Customer feedback");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(popup("Customer feedback")).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(popup("Customer feedback")).not.toBeNull();
    expect(button.parentElement!.classList).toContain("v2-class---drop-down-button--open");
    expect(row("Customer feedback").classList).toContain(
      "v2-class---my-surveys-page__list-item--dd-open",
    );

    fireEvent.click(button);
    expect(popup("Customer feedback")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(row("Customer feedback").classList).not.toContain(
      "v2-class---my-surveys-page__list-item--dd-open",
    );
  });

  it("opens with Enter or Space and closes with Escape, focus back on the dots", async () => {
    await renderList("/", [sampleSurvey]);
    const button = trigger("Customer feedback");

    fireEvent.keyDown(button, { key: "Enter" });
    expect(popup("Customer feedback")).not.toBeNull();
    fireEvent.keyDown(button, { key: "Enter" });
    expect(popup("Customer feedback")).toBeNull();

    fireEvent.keyDown(button, { key: " " });
    const menu = within(popup("Customer feedback")!);
    const clone = menu.getByRole("link", { name: "Clone" });
    clone.focus();
    fireEvent.keyDown(clone, { key: "Escape" });
    expect(popup("Customer feedback")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes on a press outside, so one menu is open at a time", async () => {
    await renderList("/", [sampleSurvey, other]);

    openMenu("Customer feedback");
    fireEvent.mouseDown(document.body);
    expect(popup("Customer feedback")).toBeNull();

    openMenu("Customer feedback");
    fireEvent.mouseDown(trigger("Team retro"));
    fireEvent.click(trigger("Team retro"));
    expect(popup("Customer feedback")).toBeNull();
    expect(popup("Team retro")).not.toBeNull();
  });

  it.each([
    {
      view: "Active, may modify, published, with projects",
      path: "/",
      survey: { ...sampleSurvey, published: true },
      projects: [marketing],
    },
    {
      view: "Active, may modify, without projects",
      path: "/",
      survey: sampleSurvey,
      projects: [],
    },
    {
      view: "Active, read-only",
      path: "/",
      survey: { ...sampleSurvey, permissions: { canModify: false } },
      projects: [marketing],
    },
    {
      view: "Archived, may modify",
      path: "/?archived=true",
      survey: { ...sampleSurvey, archived: true },
      projects: [marketing],
    },
    {
      view: "Archived, read-only",
      path: "/?archived=true",
      survey: { ...sampleSurvey, archived: true, permissions: { canModify: false } },
      projects: [marketing],
    },
  ])("shows the entries of surveyMenuItems ($view)", async ({ path, survey, projects }) => {
    await renderList(path, [survey], projects);

    openMenu(survey.name);

    expect(menuTexts(survey.name)).toEqual(
      expectedTexts(survey, { archived: survey.archived, hasProjects: projects.length > 0 }),
    );
  });

  it("links Run to the run page in a new tab, and Edit, View Results and View History", async () => {
    await renderList("/", [{ ...sampleSurvey, published: true }]);
    const menu = openMenu("Customer feedback");
    const id = sampleSurvey.id;

    const run = menu.getByRole("link", { name: "Run" });
    expect(run.getAttribute("href")).toBe(`/s/${id}`);
    expect(run.getAttribute("target")).toBe("_blank");
    expect(run.getAttribute("rel")).toBe("noopener noreferrer");
    expect(menu.getByRole("link", { name: "Edit" }).getAttribute("href")).toBe(
      `/surveys/${id}/edit`,
    );
    expect(menu.getByRole("link", { name: "View Results" }).getAttribute("href")).toBe(
      `/surveys/${id}/results`,
    );
    expect(menu.getByRole("link", { name: "View History" }).getAttribute("href")).toBe(
      `/surveys/${id}/history`,
    );
  });

  it("opens a submenu with a click or Enter on its text", async () => {
    await renderList("/", [sampleSurvey]);
    const menu = openMenu("Customer feedback");
    const ids = menu.getByRole("button", { name: "Survey IDs" });
    const submenu = () => ids.parentElement!.querySelector(".v2-class---drop-down-menu")!;

    expect(submenu().classList).not.toContain("v2-class---drop-down-menu--open");
    fireEvent.click(ids);
    expect(submenu().classList).toContain("v2-class---drop-down-menu--open");
    expect(ids.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(ids, { key: "Enter" });
    expect(submenu().classList).not.toContain("v2-class---drop-down-menu--open");
    // The menu itself stays open.
    expect(popup("Customer feedback")).not.toBeNull();
  });
});

describe("the row menu's actions", () => {
  it.each([
    { item: "Publish", path: "/", survey: sampleSurvey, body: { published: true } },
    {
      item: "Unpublish",
      path: "/",
      survey: { ...sampleSurvey, published: true },
      body: { published: false },
    },
    { item: "Archive", path: "/", survey: sampleSurvey, body: { archived: true } },
    {
      item: "Restore",
      path: "/?archived=true",
      survey: { ...sampleSurvey, archived: true },
      body: { archived: false },
    },
  ])("$item sends a merge patch and closes the menu", async ({ item, path, survey, body }) => {
    const requests: { body: unknown; contentType: string | null }[] = [];
    server.use(
      updateSurveyHandler({ ...survey, ...body }, (sent, contentType) =>
        requests.push({ body: sent, contentType }),
      ),
    );
    await renderList(path, [survey]);

    fireEvent.click(openMenu(survey.name).getByRole("link", { name: item }));

    expect(popup(survey.name)).toBeNull();
    await waitFor(() =>
      expect(requests).toEqual([{ body, contentType: "application/merge-patch+json" }]),
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it("Clone posts a clone of the survey without asking", async () => {
    const urls: string[] = [];
    server.use(
      cloneSurveyHandler({ ...other, name: "Copy of Customer feedback" }, (request) =>
        urls.push(new URL(request.url).pathname),
      ),
    );
    await renderList("/", [sampleSurvey]);

    fireEvent.click(openMenu("Customer feedback").getByRole("link", { name: "Clone" }));

    await waitFor(() => expect(urls).toEqual([`/api/v1/surveys/${sampleSurvey.id}/clones`]));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("Delete asks first, then deletes the survey", async () => {
    const archived = { ...sampleSurvey, archived: true };
    const deleted: string[] = [];
    server.use(deleteSurveyHandler((request) => deleted.push(new URL(request.url).pathname)));
    await renderList("/?archived=true", [archived]);

    fireEvent.click(openMenu(archived.name).getByRole("link", { name: "Delete" }));

    expect(confirm).toHaveBeenCalledExactlyOnceWith(DELETE_TEXT);
    await waitFor(() => expect(deleted).toEqual([`/api/v1/surveys/${archived.id}`]));
  });

  it("Delete sends nothing when the confirmation is cancelled", async () => {
    confirm.mockReturnValue(false);
    const archived = { ...sampleSurvey, archived: true };
    const deleted: string[] = [];
    server.use(deleteSurveyHandler((request) => deleted.push(request.url)));
    await renderList("/?archived=true", [archived]);

    fireEvent.click(openMenu(archived.name).getByRole("link", { name: "Delete" }));

    expect(confirm).toHaveBeenCalledExactlyOnceWith(DELETE_TEXT);
    await settle();
    expect(deleted).toEqual([]);
  });

  it("Move asks first, moves the survey, then opens the target project's active list", async () => {
    const bodies: unknown[] = [];
    server.use(
      updateSurveyHandler({ ...sampleSurvey, projectId: marketing.id }, (body) =>
        bodies.push(body),
      ),
    );
    const router = await renderList("/", [sampleSurvey], [marketing, engineering]);

    const menu = openMenu("Customer feedback");
    fireEvent.click(menu.getByRole("button", { name: "Move to Project" }));
    fireEvent.click(menu.getByRole("link", { name: "Marketing" }));

    expect(confirm).toHaveBeenCalledExactlyOnceWith(MOVE_TEXT);
    await waitFor(() => expect(router.state.location.href).toBe(`/?project=${marketing.id}`));
    expect(bodies).toEqual([{ projectId: marketing.id }]);
  });

  it("Move offers Personal Surveys inside a project, and moves there", async () => {
    const inMarketing = { ...sampleSurvey, projectId: marketing.id };
    const bodies: unknown[] = [];
    server.use(updateSurveyHandler(sampleSurvey, (body) => bodies.push(body)));
    const router = await renderList(
      `/?project=${marketing.id}`,
      [inMarketing],
      [marketing, engineering],
    );

    const menu = openMenu("Customer feedback");
    fireEvent.click(menu.getByRole("button", { name: "Move to Project" }));
    // The survey's own project is marked and inert.
    const current = menu.getByText("Marketing").closest("a")!;
    expect(current.getAttribute("href")).toBeNull();
    expect(current.classList).toContain("v2-class---drop-down-menu-item__link--selected");
    fireEvent.click(menu.getByRole("link", { name: "Personal Surveys" }));

    await waitFor(() => expect(router.state.location.href).toBe("/"));
    expect(bodies).toEqual([{ projectId: null }]);
  });

  it("Move sends nothing and stays on the list when the confirmation is cancelled", async () => {
    confirm.mockReturnValue(false);
    const bodies: unknown[] = [];
    server.use(updateSurveyHandler(sampleSurvey, (body) => bodies.push(body)));
    const router = await renderList("/", [sampleSurvey], [marketing]);

    const menu = openMenu("Customer feedback");
    fireEvent.click(menu.getByRole("button", { name: "Move to Project" }));
    fireEvent.click(menu.getByRole("link", { name: "Marketing" }));

    expect(confirm).toHaveBeenCalledExactlyOnceWith(MOVE_TEXT);
    await settle();
    expect(bodies).toEqual([]);
    expect(router.state.location.href).toBe("/");
  });

  it.each([
    { item: "Copy ID", value: sampleSurvey.id },
    { item: "Copy Result ID", value: sampleSurvey.resultId },
    { item: "Copy Post ID", value: sampleSurvey.postId },
  ])("$item copies the value and closes the menu", async ({ item, value }) => {
    await renderList("/", [sampleSurvey]);

    const menu = openMenu("Customer feedback");
    fireEvent.click(menu.getByRole("button", { name: "Survey IDs" }));
    fireEvent.click(menu.getByRole("link", { name: item }));

    expect(writeText).toHaveBeenCalledExactlyOnceWith(value);
    expect(popup("Customer feedback")).toBeNull();
  });

  it("shows a clipboard failure", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    await renderList("/", [sampleSurvey]);

    fireEvent.click(openMenu("Customer feedback").getByRole("link", { name: "Copy ID" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Could not copy to the clipboard.");
  });

  it("shows a failed action until the next action", async () => {
    server.use(surveyActionProblemHandler("patch"));
    await renderList("/", [sampleSurvey]);

    fireEvent.click(openMenu("Customer feedback").getByRole("link", { name: "Publish" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not publish the survey. Please try again.",
    );

    fireEvent.click(openMenu("Customer feedback").getByRole("link", { name: "Copy ID" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    { item: "Archive", verb: "archive", method: "patch" as const },
    { item: "Clone", verb: "clone", method: "post" as const },
  ])("names the failed action ($item)", async ({ item, verb, method }) => {
    server.use(surveyActionProblemHandler(method));
    await renderList("/", [sampleSurvey]);

    fireEvent.click(openMenu("Customer feedback").getByRole("link", { name: item }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      `Could not ${verb} the survey. Please try again.`,
    );
  });
});
