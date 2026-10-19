import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http as mswHttp } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { definitionHandler } from "./test/content-handlers";
import { changedLayout } from "./test/fakeResultsWidget";
import { renderApp } from "./test/renderApp";
import {
  resetViewHandler,
  resultPagesHandler,
  sampleResponses,
  saveViewHandler,
  viewHandler,
  viewProblemHandler,
  type SeenViewSave,
} from "./test/results-handlers";
import { configHandler, meHandler, sampleSurvey, server, surveyHandler } from "./test/server";

// jsdom runs neither the Dashboard's charts nor Tabulator: the fakes show what the page passes.
vi.mock("./results/SummaryView", async () => {
  const { fakeResultsWidget } = await import("./test/fakeResultsWidget");
  return { SummaryView: fakeResultsWidget("fake-summary") };
});
vi.mock("./results/TableView", async () => {
  const { fakeResultsWidget } = await import("./test/fakeResultsWidget");
  return { TableView: fakeResultsWidget("fake-table") };
});

const surveyId = sampleSurvey.id;
const path = `/surveys/${surveyId}/results`;
const RESET_SUMMARY_TEXT =
  "Your custom survey data summary will be reset to its default state. Please be aware that the summary state reset is irreversible.";
const RESET_TABLE_TEXT =
  "Your custom survey data table will be reset to its default state. Please be aware that the table state reset is irreversible.";

/** Records `METHOD /path?query` of every API request. */
function recordRequests() {
  const requests: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    requests.push(`${request.method} ${url.pathname}${url.search}`);
  };
  server.events.on("request:start", listener);
  return {
    requests,
    count: (entry: string) => requests.filter((request) => request === entry).length,
    stop: () => server.events.removeListener("request:start", listener),
  };
}

/** The page's usual reads: the survey, two result pages (3 responses) and no saved views. */
function pageHandlers({ summary = null }: { summary?: Record<string, unknown> | null } = {}) {
  return [
    configHandler(),
    meHandler(),
    surveyHandler(),
    definitionHandler({ elements: [{ type: "rating", name: "q1" }] }),
    resultPagesHandler([sampleResponses(2), sampleResponses(1, 3)]),
    viewHandler("summary", summary),
    viewHandler("table", null),
  ];
}

const tab = (name: string) => screen.getByRole("link", { name });
const shownState = (testId: string) =>
  JSON.parse(screen.getByTestId(`${testId}-state`).textContent!) as unknown;
const viewPath = (view: string) => `/api/v1/surveys/${surveyId}/views/${view}`;

let recorder: ReturnType<typeof recordRequests> | null = null;
function record() {
  recorder = recordRequests();
  return recorder;
}

afterEach(() => {
  recorder?.stop();
  recorder = null;
  vi.restoreAllMocks();
});

describe("the results page", () => {
  it("shows the survey name, the tabs and the summary over every result page", async () => {
    server.use(...pageHandlers());
    const { requests } = record();

    renderApp(path);

    expect(await screen.findByRole("heading", { level: 1, name: sampleSurvey.name })).toBeTruthy();
    const summary = await screen.findByTestId("fake-summary");
    expect(within(summary).getByText("3 responses")).toBeTruthy();
    expect(shownState("fake-summary")).toBeNull();
    expect(requests.filter((request) => request.includes("/results"))).toEqual([
      `GET /api/v1/surveys/${surveyId}/results?limit=1000`,
      `GET /api/v1/surveys/${surveyId}/results?limit=1000&cursor=c1`,
    ]);

    expect(tab("Summary").getAttribute("aria-current")).toBe("page");
    expect(tab("Summary").getAttribute("href")).toBe(path);
    expect(tab("Table").getAttribute("aria-current")).toBeNull();
    expect(tab("Table").getAttribute("href")).toBe(`${path}?tab=table`);
    expect(tab("Details").getAttribute("aria-current")).toBeNull();
    expect(tab("Details").getAttribute("href")).toBe(`${path}?tab=details`);
    expect(screen.getByRole("link", { name: "Back to My Surveys" })).toBeTruthy();
  });

  it("shows the table on ?tab=table", async () => {
    server.use(...pageHandlers());

    renderApp(`${path}?tab=table`);

    const table = await screen.findByTestId("fake-table");
    expect(within(table).getByText("3 responses")).toBeTruthy();
    expect(tab("Table").getAttribute("aria-current")).toBe("page");
    expect(tab("Summary").getAttribute("aria-current")).toBeNull();
    expect(screen.queryByTestId("fake-summary")).toBeNull();
  });

  it("shows the summary on an unknown tab", async () => {
    server.use(...pageHandlers());

    renderApp(`${path}?tab=bogus`);

    expect(await screen.findByTestId("fake-summary")).toBeTruthy();
    expect(tab("Summary").getAttribute("aria-current")).toBe("page");
  });

  it("hands the saved summary layout to the summary", async () => {
    const saved = { elements: [{ name: "q1", isVisible: true, chartType: "pie" }] };
    server.use(...pageHandlers({ summary: saved }));

    renderApp(path);

    await screen.findByTestId("fake-summary");
    expect(shownState("fake-summary")).toEqual(saved);
  });

  it("saves a changed layout once and shows it again after a tab switch without a new read", async () => {
    const saves: SeenViewSave[] = [];
    server.use(
      ...pageHandlers(),
      saveViewHandler("summary", (seen) => saves.push(seen)),
    );
    const { count } = record();
    renderApp(path);

    fireEvent.click(await screen.findByRole("button", { name: "Change layout" }));

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]!.body).toEqual(changedLayout);
    fireEvent.click(tab("Table"));
    await screen.findByTestId("fake-table");
    fireEvent.click(tab("Summary"));
    await screen.findByTestId("fake-summary");
    expect(shownState("fake-summary")).toEqual(changedLayout);
    expect(count(`GET ${viewPath("summary")}`)).toBe(1);
    expect(count(`PUT ${viewPath("summary")}`)).toBe(1);
  });

  it("says quietly when a layout could not be saved", async () => {
    server.use(...pageHandlers(), viewProblemHandler("put", "summary", 500, "internal-error"));
    renderApp(path);

    fireEvent.click(await screen.findByRole("button", { name: "Change layout" }));

    expect(
      await screen.findByText(
        "Your layout could not be saved. It is saved again with your next change.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("fake-summary")).toBeTruthy();
  });

  it("says when the results could not be loaded and tries again", async () => {
    let attempts = 0;
    server.use(
      // Before the usual handlers: the first matching handler answers.
      mswHttp.get("*/api/v1/surveys/:surveyId/results", () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.json(
              { type: "about:blank", title: "Boom", status: 500, code: "internal-error" },
              { status: 500, headers: { "Content-Type": "application/problem+json" } },
            )
          : HttpResponse.json({ items: sampleResponses(3), nextCursor: null });
      }),
      ...pageHandlers(),
    );
    renderApp(path);

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(
        "The results could not be loaded. Check your connection and try again.",
      ),
    ).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    const summary = await screen.findByTestId("fake-summary");
    expect(within(summary).getByText("3 responses")).toBeTruthy();
    expect(attempts).toBe(2);
  });
});

describe("the Details tab", () => {
  it("shows the two reset sections", async () => {
    server.use(...pageHandlers());

    renderApp(`${path}?tab=details`);

    expect(await screen.findByText(RESET_TABLE_TEXT)).toBeTruthy();
    expect(screen.getByText(RESET_SUMMARY_TEXT)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset Table State" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset Summary State" })).toBeTruthy();
    expect(tab("Details").getAttribute("aria-current")).toBe("page");
  });

  it("does nothing when the reset is not confirmed", async () => {
    let resets = 0;
    server.use(
      ...pageHandlers(),
      resetViewHandler("summary", () => (resets += 1)),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderApp(`${path}?tab=details`);

    fireEvent.click(await screen.findByRole("button", { name: "Reset Summary State" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("The summary layout is reset.")).toBeNull();
    expect(resets).toBe(0);
  });

  it("resets the summary layout after the confirm, and the summary shows the default", async () => {
    const saved = { elements: [{ name: "q1", isVisible: false }] };
    let resets = 0;
    server.use(
      ...pageHandlers({ summary: saved }),
      resetViewHandler("summary", () => (resets += 1)),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { count } = record();
    renderApp(`${path}?tab=details`);

    fireEvent.click(await screen.findByRole("button", { name: "Reset Summary State" }));

    expect(await screen.findByText("The summary layout is reset.")).toBeTruthy();
    expect(confirm).toHaveBeenCalledExactlyOnceWith(
      "Are you absolutely sure that you want to remove summary state ?",
    );
    expect(resets).toBe(1);
    fireEvent.click(tab("Summary"));
    await screen.findByTestId("fake-summary");
    expect(shownState("fake-summary")).toBeNull();
    expect(count(`GET ${viewPath("summary")}`)).toBe(1);
  });

  it("asks before resetting the table layout", async () => {
    let resets = 0;
    server.use(
      ...pageHandlers(),
      resetViewHandler("table", () => (resets += 1)),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp(`${path}?tab=details`);

    fireEvent.click(await screen.findByRole("button", { name: "Reset Table State" }));

    expect(await screen.findByText("The table layout is reset.")).toBeTruthy();
    expect(confirm).toHaveBeenCalledExactlyOnceWith(
      "Are you absolutely sure that you want to remove table state ?",
    );
    expect(resets).toBe(1);
  });

  it("says when a reset failed", async () => {
    server.use(...pageHandlers(), viewProblemHandler("delete", "summary", 500, "internal-error"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp(`${path}?tab=details`);

    fireEvent.click(await screen.findByRole("button", { name: "Reset Summary State" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The layout was not reset. Please try again.",
    );
  });
});
