import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http as mswHttp } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  definitionHandler,
  editConflictHandler,
  saveDefinitionHandler,
  saveThemeHandler,
  themeHandler,
  type SavedContent,
} from "../test/content-handlers";
import { renderApp } from "../test/renderApp";
import {
  configHandler,
  http,
  meHandler,
  sampleSurvey,
  server,
  surveyHandler,
} from "../test/server";
import type { SurveyEditorProps } from "./SurveyEditor";

// jsdom never loads the Creator: the fake shows what the page passes and keeps the latest props.
const editor = vi.hoisted(() => ({ props: null as SurveyEditorProps | null }));
vi.mock("./SurveyEditor", () => ({
  SurveyEditor: (props: SurveyEditorProps) => {
    editor.props = props;
    return <pre data-testid="fake-creator">{JSON.stringify(props.documents)}</pre>;
  },
}));

const path = `/surveys/${sampleSurvey.id}/edit`;
const shown = () => JSON.parse(screen.getByTestId("fake-creator").textContent!) as unknown;
const saves = () => editor.props!.saves!;

/** Asks the page to save `content` as the Creator does; resolves to the `done` outcome. */
function save(document: "definition" | "theme", content: Record<string, unknown>) {
  return act(
    () => new Promise<boolean>((resolve) => saves()[document](content, (ok) => resolve(ok))),
  );
}

async function openEditor(survey = sampleSurvey) {
  server.use(
    configHandler(),
    meHandler(),
    surveyHandler(survey),
    definitionHandler({ title: "First" }, '"v1"'),
    themeHandler({ themeName: "default" }, '"t1"'),
  );
  renderApp(path);
  await screen.findByTestId("fake-creator");
}

beforeEach(() => {
  editor.props = null;
});

describe("the editor page", () => {
  it("shows the survey name, the documents and the status once loaded", async () => {
    await openEditor();

    expect(shown()).toEqual({ definition: { title: "First" }, theme: { themeName: "default" } });
    expect(screen.getByText("Customer feedback")).toBeTruthy();
    expect(screen.getByText("All changes saved")).toBeTruthy();
    expect(editor.props!.saves).not.toBeNull();
  });

  it("is read-only without modify rights", async () => {
    await openEditor({ ...sampleSurvey, permissions: { canModify: false } });

    expect(screen.getByText("Read-only")).toBeTruthy();
    expect(editor.props!.saves).toBeNull();
  });

  it("saves through the savers with the ETags of the reads, chaining the new ones", async () => {
    await openEditor();
    const definitions: SavedContent[] = [];
    const themes: SavedContent[] = [];
    server.use(
      saveDefinitionHandler('"v2"', (saved) => definitions.push(saved)),
      saveThemeHandler('"t2"', (saved) => themes.push(saved)),
    );

    expect(await save("definition", { title: "Second" })).toBe(true);
    expect(await save("definition", { title: "Third" })).toBe(true);
    expect(await save("theme", { themeName: "flat" })).toBe(true);

    expect(definitions).toEqual([
      { ifMatch: '"v1"', body: { title: "Second" } },
      { ifMatch: '"v2"', body: { title: "Third" } },
    ]);
    expect(themes).toEqual([{ ifMatch: '"t1"', body: { themeName: "flat" } }]);
    expect(screen.getByText("All changes saved")).toBeTruthy();
  });

  it("shows the conflict notice on a 412 and stops saving both documents", async () => {
    await openEditor();
    const themes: SavedContent[] = [];
    server.use(
      editConflictHandler("definition"),
      saveThemeHandler('"t2"', (saved) => themes.push(saved)),
    );

    expect(await save("definition", { title: "Mine" })).toBe(false);

    const notice = await screen.findByRole("alert");
    expect(notice.textContent).toContain(
      "The survey was changed by someone else. Your latest changes are not saved.",
    );
    expect(screen.getByRole("button", { name: "Reload latest" })).toBeTruthy();
    expect(screen.getByText("Changes are not saved")).toBeTruthy();
    expect(await save("theme", { themeName: "flat" })).toBe(false);
    expect(await save("definition", { title: "Mine again" })).toBe(false);
    expect(themes).toEqual([]);
  });

  it("reloads both documents with 'Reload latest' and saves on with their ETags", async () => {
    await openEditor();
    server.use(editConflictHandler("definition"));
    await save("definition", { title: "Mine" });
    await screen.findByRole("alert");

    const reads: string[] = [];
    const definitions: SavedContent[] = [];
    server.use(
      definitionHandler({ title: "Theirs" }, '"v7"'),
      themeHandler({ themeName: "sharp" }, '"t7"'),
      saveDefinitionHandler('"v8"', (saved) => definitions.push(saved)),
    );
    server.events.on("request:start", ({ request }) => {
      if (request.method === "GET") reads.push(new URL(request.url).pathname);
    });
    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));

    await waitFor(() =>
      expect(shown()).toEqual({ definition: { title: "Theirs" }, theme: { themeName: "sharp" } }),
    );
    server.events.removeAllListeners();
    expect(reads.sort()).toEqual([
      `/api/v1/surveys/${sampleSurvey.id}/definition`,
      `/api/v1/surveys/${sampleSurvey.id}/theme`,
    ]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("All changes saved")).toBeTruthy();

    expect(await save("definition", { title: "Theirs and mine" })).toBe(true);
    expect(definitions).toEqual([{ ifMatch: '"v7"', body: { title: "Theirs and mine" } }]);
  });

  it("keeps the editor and the notice when 'Reload latest' fails, and reloads on the next try", async () => {
    await openEditor();
    server.use(editConflictHandler("definition"));
    await save("definition", { title: "Mine" });
    await screen.findByRole("alert");
    const shownEditor = screen.getByTestId("fake-creator");
    server.use(
      mswHttp.get("*/api/v1/surveys/:surveyId/definition", () =>
        HttpResponse.json(
          { type: "about:blank", title: "Server error", status: 500, code: "internal-error" },
          { status: 500, headers: { "Content-Type": "application/problem+json" } },
        ),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));

    await screen.findByText("Could not reload the survey. Please try again.");
    expect(screen.getByRole("alert").textContent).toContain(
      "The survey was changed by someone else.",
    );
    expect(screen.getByTestId("fake-creator")).toBe(shownEditor);
    expect(shown()).toEqual({ definition: { title: "First" }, theme: { themeName: "default" } });
    expect(screen.queryByText("Could not load the survey. Please try again.")).toBeNull();

    server.use(definitionHandler({ title: "Theirs" }, '"v7"'), themeHandler({}, '"t7"'));
    const reload = screen.getByRole("button", { name: "Reload latest" });
    await waitFor(() => expect((reload as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(reload);

    await waitFor(() => expect(shown()).toEqual({ definition: { title: "Theirs" }, theme: {} }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("fake-creator")).toBe(shownEditor);
  });

  it("offers 'Reload latest' only once no save of the other document is in flight", async () => {
    await openEditor();
    let answerTheme: () => void = () => {};
    server.use(
      editConflictHandler("definition"),
      http.put("/surveys/{surveyId}/theme", async ({ response }) => {
        await new Promise<void>((resolve) => (answerTheme = resolve));
        return response(204).empty({ headers: { ETag: '"t2"' } });
      }),
    );

    // Not in act(): the theme save stays open while the test goes on.
    const themeSaved = new Promise<boolean>((resolve) =>
      saves().theme({ themeName: "flat" }, (ok) => resolve(ok)),
    );
    await save("definition", { title: "Mine" });
    const reload = await screen.findByRole("button", { name: "Reload latest" });
    expect((reload as HTMLButtonElement).disabled).toBe(true);

    answerTheme();
    expect(await themeSaved).toBe(true);
    await waitFor(() => expect((reload as HTMLButtonElement).disabled).toBe(false));
  });

  it("shows that changes are not saved when a save fails, and retries with the next one", async () => {
    await openEditor();
    server.use(
      mswHttp.put(
        "*/api/v1/surveys/:surveyId/definition",
        () =>
          HttpResponse.json(
            { type: "about:blank", title: "Server error", status: 500, code: "internal-error" },
            { status: 500, headers: { "Content-Type": "application/problem+json" } },
          ),
        { once: true },
      ),
    );

    expect(await save("definition", { title: "Lost" })).toBe(false);
    expect(screen.getByText("Changes are not saved")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    const definitions: SavedContent[] = [];
    server.use(saveDefinitionHandler('"v2"', (saved) => definitions.push(saved)));
    expect(await save("definition", { title: "Kept" })).toBe(true);
    expect(definitions).toEqual([{ ifMatch: '"v1"', body: { title: "Kept" } }]);
    expect(screen.getByText("All changes saved")).toBeTruthy();
  });
});
