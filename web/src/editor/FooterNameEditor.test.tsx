import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { definitionHandler, themeHandler } from "../test/content-handlers";
import { renderApp } from "../test/renderApp";
import {
  configHandler,
  meHandler,
  sampleSurvey,
  server,
  surveyActionProblemHandler,
  surveyHandler,
  updateSurveyHandler,
} from "../test/server";

// jsdom never loads the Creator.
vi.mock("./SurveyEditor", () => ({ SurveyEditor: () => <div data-testid="fake-creator" /> }));

const FAILED = "Could not rename the survey. Please try again.";

async function openEditor(survey = sampleSurvey) {
  server.use(
    configHandler(),
    meHandler(),
    surveyHandler(survey),
    definitionHandler({}, '"v1"'),
    themeHandler({}, '"t1"'),
  );
  renderApp(`/surveys/${survey.id}/edit`);
  await screen.findByTestId("fake-creator");
}

const bar = () => document.getElementById("edit-survey-change-name-container")!;
const input = () => within(bar()).getByRole("textbox", { name: "Survey name" }) as HTMLInputElement;
const openNameEditor = () => fireEvent.click(within(bar()).getByText(sampleSurvey.name));

/** Collects the bodies of the rename requests; answers with the renamed survey. */
function recordRenames() {
  const bodies: unknown[] = [];
  server.use(
    updateSurveyHandler({ ...sampleSurvey, name: "Renamed" }, (body) => bodies.push(body)),
  );
  return bodies;
}

describe("the footer name editor", () => {
  it("opens with the name on a click", async () => {
    await openEditor();

    openNameEditor();

    expect(input().value).toBe(sampleSurvey.name);
  });

  it("saves the new name once on Enter", async () => {
    await openEditor();
    const bodies = recordRenames();
    openNameEditor();

    fireEvent.change(input(), { target: { value: "Renamed" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(within(bar()).queryByRole("textbox")).toBeNull();
    expect(within(bar()).getByText("Renamed")).toBeTruthy();
    await waitFor(() => expect(bodies).toEqual([{ name: "Renamed" }]));
    // The box is gone, so its blur saves nothing more.
    expect(bodies).toHaveLength(1);
  });

  it("saves when the box loses the focus", async () => {
    await openEditor();
    const bodies = recordRenames();
    openNameEditor();

    fireEvent.change(input(), { target: { value: "Renamed" } });
    fireEvent.blur(input());

    await waitFor(() => expect(bodies).toEqual([{ name: "Renamed" }]));
  });

  it("restores the name on Escape and on Cancel, without a request", async () => {
    await openEditor();
    const bodies = recordRenames();

    openNameEditor();
    fireEvent.change(input(), { target: { value: "Something else" } });
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(within(bar()).getByText(sampleSurvey.name)).toBeTruthy();

    openNameEditor();
    fireEvent.change(input(), { target: { value: "Something else" } });
    fireEvent.mouseDown(within(bar()).getByText("Cancel"));
    expect(within(bar()).queryByRole("textbox")).toBeNull();
    expect(within(bar()).getByText(sampleSurvey.name)).toBeTruthy();

    // A request would have been sent by now.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bodies).toEqual([]);
  });

  it("sends nothing for a blank or unchanged name", async () => {
    await openEditor();
    const bodies = recordRenames();

    openNameEditor();
    fireEvent.change(input(), { target: { value: "   " } });
    fireEvent.keyDown(input(), { key: "Enter" });
    openNameEditor();
    fireEvent.keyDown(input(), { key: "Enter" });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bodies).toEqual([]);
    expect(within(bar()).getByText(sampleSurvey.name)).toBeTruthy();
  });

  it("brings the old name back and shows a notice when the rename fails, until the next one", async () => {
    await openEditor();
    server.use(surveyActionProblemHandler("patch"));
    openNameEditor();

    fireEvent.change(input(), { target: { value: "Renamed" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect((await screen.findByRole("alert")).textContent).toBe(FAILED);
    expect(within(bar()).getByText(sampleSurvey.name)).toBeTruthy();

    recordRenames();
    openNameEditor();
    fireEvent.change(input(), { target: { value: "Renamed" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(screen.queryByText(FAILED)).toBeNull();
    await waitFor(() => expect(within(bar()).getByText("Renamed")).toBeTruthy());
  });

  it("does not open without modify rights", async () => {
    await openEditor({ ...sampleSurvey, permissions: { canModify: false } });

    openNameEditor();

    expect(within(bar()).queryByRole("textbox")).toBeNull();
    expect(within(bar()).queryByRole("link", { name: "Rename survey" })).toBeNull();
  });
});
