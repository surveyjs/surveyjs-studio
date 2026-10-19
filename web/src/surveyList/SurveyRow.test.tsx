import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Survey, SurveyPage } from "../api/surveys";
import { definitionHandler, themeHandler } from "../test/content-handlers";
import { renderApp } from "../test/renderApp";
import {
  configHandler,
  http,
  meHandler,
  projectsHandler,
  sampleSurvey,
  server,
  surveyActionProblemHandler,
  surveyHandler,
  surveysHandler,
} from "../test/server";

// The editor page opens without the Creator (jsdom cannot run it).
vi.mock("../editor/SurveyEditor", () => ({
  SurveyEditor: () => <div data-testid="fake-creator" />,
}));

/**
 * Renders My Surveys at `path` with `survey`. The list answers what the PATCH handler stored, as a
 * server would; `bodies` collects the PATCH bodies.
 */
async function renderList(path: string, survey: Survey, failRename = false) {
  const pages: Record<string, SurveyPage> = { "": { items: [survey], nextCursor: null } };
  const bodies: unknown[] = [];
  server.use(
    configHandler(),
    meHandler(),
    surveysHandler(pages),
    projectsHandler({ "": { items: [], nextCursor: null } }),
    failRename
      ? surveyActionProblemHandler("patch")
      : http.patch("/surveys/{surveyId}", async ({ request, response }) => {
          const body = (await request.json()) as { name: string };
          bodies.push(body);
          const updated = { ...survey, name: body.name };
          pages[""] = { items: [updated], nextCursor: null };
          return response(200).json(updated);
        }),
  );
  renderApp(path);
  await screen.findByText(survey.name);
  return bodies;
}

const row = () => document.querySelector<HTMLElement>(".v2-class---my-surveys-page__list-item")!;
const header = () => row().querySelector(".v2-class---my-surveys-page__list-item-header")!;
const shownName = () => row().querySelector(".v2-class---my-surveys-page__survey-name")!;
const pencil = () => within(row()).queryByRole("link", { name: "Rename survey" });
const input = () => within(row()).queryByRole<HTMLInputElement>("textbox", { name: "Survey name" });

/** Lets a request that should not be sent have the chance to be sent. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function startRename() {
  fireEvent.click(pencil()!);
  return input()!;
}

describe("renaming a survey in the list", () => {
  it("shows the pencil only in the Active view and when the survey may be modified", async () => {
    await renderList("/", sampleSurvey);
    expect(pencil()).not.toBeNull();
    expect(
      pencil()!.querySelector(".v2-class---my-surveys-page__edit-icon--svg svg"),
    ).not.toBeNull();
  });

  it("has no pencil without modify rights", async () => {
    await renderList("/", { ...sampleSurvey, permissions: { canModify: false } });
    expect(pencil()).toBeNull();
  });

  it("has no pencil in the Archived view", async () => {
    await renderList("/?archived=true", { ...sampleSurvey, archived: true });
    expect(pencil()).toBeNull();
  });

  it("gives each row's pencil its own clip-path id", async () => {
    await renderList("/", sampleSurvey);
    const clipPath = pencil()!.querySelector("clipPath")!;
    expect(clipPath.id).not.toBe("clip0_17855_154879");
    expect(pencil()!.querySelector("g")!.getAttribute("clip-path")).toBe(`url(#${clipPath.id})`);
  });

  it("opens the editor focused, with the name selected, in place of the name", async () => {
    await renderList("/", sampleSurvey);

    const box = startRename();

    expect(box.value).toBe("Customer feedback");
    expect(box.getAttribute("placeholder")).toBe("Enter a survey name...");
    expect(box.maxLength).toBe(200);
    expect(document.activeElement).toBe(box);
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, "Customer feedback".length]);
    expect(header().classList).toContain(
      "v2-class---my-surveys-page__list-item-header--title-edit-mode",
    );
    const nameContainer = row().querySelector<HTMLElement>(
      ".v2-class---my-surveys-page__survey-name-container",
    )!;
    expect(nameContainer.style.display).toBe("none");
  });

  it("saves with Enter: shows the new name at once and sends it as typed", async () => {
    const bodies = await renderList("/", sampleSurvey);

    const box = startRename();
    fireEvent.change(box, { target: { value: " Customer feedback 2026 " } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(input()).toBeNull();
    expect(shownName().textContent).toBe(" Customer feedback 2026 ");
    await waitFor(() => expect(bodies).toEqual([{ name: " Customer feedback 2026 " }]));
    expect(shownName().textContent).toBe(" Customer feedback 2026 ");
    expect(document.activeElement).toBe(pencil());
  });

  it("saves with the Save button", async () => {
    const bodies = await renderList("/", sampleSurvey);

    fireEvent.change(startRename(), { target: { value: "Feedback" } });
    fireEvent.click(within(row()).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(bodies).toEqual([{ name: "Feedback" }]));
    expect(shownName().textContent).toBe("Feedback");
  });

  it("cancels with Escape or the Cancel link, sending nothing", async () => {
    const bodies = await renderList("/", sampleSurvey);

    let box = startRename();
    fireEvent.change(box, { target: { value: "Something else" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(input()).toBeNull();
    expect(document.activeElement).toBe(pencil());

    box = startRename();
    expect(box.value).toBe("Customer feedback");
    fireEvent.change(box, { target: { value: "Something else" } });
    fireEvent.click(within(row()).getByRole("link", { name: "Cancel" }));
    expect(input()).toBeNull();

    await settle();
    expect(bodies).toEqual([]);
    expect(shownName().textContent).toBe("Customer feedback");
  });

  it.each([
    { case: "blank", value: "   " },
    { case: "unchanged", value: "Customer feedback" },
  ])("closes without a request when the name is $case", async ({ value }) => {
    const bodies = await renderList("/", sampleSurvey);

    const box = startRename();
    fireEvent.change(box, { target: { value } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(input()).toBeNull();
    await settle();
    expect(bodies).toEqual([]);
    expect(shownName().textContent).toBe("Customer feedback");
  });

  it("shows the old name again and the error when the rename fails", async () => {
    await renderList("/", sampleSurvey, true);

    const box = startRename();
    fireEvent.change(box, { target: { value: "Renamed" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(shownName().textContent).toBe("Renamed");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not rename the survey. Please try again.",
    );
    expect(shownName().textContent).toBe("Customer feedback");
  });
});

describe("opening the editor from the list", () => {
  async function renderRow(path: string, survey: Survey) {
    server.use(
      configHandler(),
      meHandler(),
      surveysHandler({ "": { items: [survey], nextCursor: null } }),
      projectsHandler({ "": { items: [], nextCursor: null } }),
      surveyHandler(survey),
      definitionHandler({}),
      themeHandler({}),
    );
    const router = renderApp(path);
    await screen.findByText(survey.name);
    return router;
  }

  const editorPath = `/surveys/${sampleSurvey.id}/edit`;
  const dates = () => row().querySelector(".v2-class---my-surveys-page__survey-date-item")!;

  it.each([
    { target: "the row", element: dates },
    { target: "the name", element: shownName },
  ])("opens the editor with a click on $target in the Active view", async ({ element }) => {
    const router = await renderRow("/", sampleSurvey);

    fireEvent.click(element());

    await waitFor(() => expect(router.state.location.pathname).toBe(editorPath));
    await screen.findByTestId("fake-creator");
  });

  it("does not open it from the menu, the pencil or the rename editor", async () => {
    const router = await renderRow("/", sampleSurvey);

    const dots = within(row()).getByRole("button", { name: "Survey actions" });
    fireEvent.click(dots);
    expect(dots.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(dots);
    fireEvent.click(pencil()!);
    fireEvent.click(input()!);
    fireEvent.click(
      row().querySelector(".v2-class---my-surveys-page__edit-survey-name-container")!,
    );

    await settle();
    expect(router.state.location.pathname).toBe("/");
    expect(input()).not.toBeNull();
  });

  it("does not open it in the Archived view", async () => {
    const router = await renderRow("/?archived=true", { ...sampleSurvey, archived: true });

    fireEvent.click(dates());
    fireEvent.click(shownName());

    await settle();
    expect(router.state.location.pathname).toBe("/");
  });
});
