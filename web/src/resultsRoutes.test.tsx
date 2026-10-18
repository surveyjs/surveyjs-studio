import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http as mswHttp } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { definitionHandler } from "./test/content-handlers";
import { changedLayout } from "./test/fakeResultsWidget";
import { renderApp } from "./test/renderApp";
import type { components } from "@my-surveys/contract/types";
import {
  deleteResultsHandler,
  resetViewHandler,
  resultPagesHandler,
  sampleResponses,
  saveViewHandler,
  statsHandler,
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

type Survey = components["schemas"]["Survey"];
type ResultStats = components["schemas"]["ResultStats"];

const surveyId = sampleSurvey.id;
const STATS: ResultStats = {
  count: 3,
  firstSubmittedAt: "2026-01-01T00:01:00.000Z",
  lastSubmittedAt: "2026-01-01T00:03:00.000Z",
};
const NO_STATS: ResultStats = { count: 0, firstSubmittedAt: null, lastSubmittedAt: null };
const surveyPath = `/api/v1/surveys/${surveyId}`;
const PATCH_FAILED = "The setting could not be saved. Please try again.";
const DELETE_WARNING = "Deletes all survey results without the possibility to restore.";
const DELETE_CONFIRM = "Are you absolutely sure that you want to delete all results ?";
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
function pageHandlers({
  summary = null,
  survey = sampleSurvey,
  stats = STATS,
}: {
  summary?: Record<string, unknown> | null;
  survey?: Survey;
  stats?: ResultStats | (() => ResultStats);
} = {}) {
  return [
    configHandler(),
    meHandler(),
    surveyHandler(survey),
    statsHandler(stats),
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
  document.cookie = "msid_csrf=; Max-Age=0";
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

/** Answers `PATCH /surveys/{id}` with `answer(body)`; `seen` gets the body and content type. */
function patchHandler(
  seen: { body: unknown; contentType: string | null }[],
  answer: (body: Record<string, unknown>) => Response | Promise<Response>,
  gate?: Promise<void>,
) {
  return mswHttp.patch(`*${surveyPath}`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    seen.push({ body, contentType: request.headers.get("Content-Type") });
    await gate;
    return answer(body);
  });
}
const surveyWith = (settings: Survey["settings"]): Survey => ({ ...sampleSurvey, settings });
const failing = () =>
  HttpResponse.json(
    { type: "about:blank", title: "Boom", status: 500, code: "internal-error" },
    { status: 500, headers: { "Content-Type": "application/problem+json" } },
  );
const row = (label: string) => screen.getByText(label).parentElement!;
const ACCESS_OFF = "Toggle if you want to enable access to the survey results with a direct link.";

describe("the Details tab: totals, downloads and toggles", () => {
  it("shows the totals, the downloads, the toggles, Delete Results and the reset sections", async () => {
    server.use(...pageHandlers());

    renderApp(`${path}?tab=details`);

    expect(await screen.findByText("Total responses:")).toBeTruthy();
    expect(within(row("Total responses:")).getByText("3")).toBeTruthy();
    expect(
      within(row("First response at:")).getByText(
        new Date(STATS.firstSubmittedAt!).toLocaleString(),
      ),
    ).toBeTruthy();
    expect(
      within(row("Last response at:")).getByText(new Date(STATS.lastSubmittedAt!).toLocaleString()),
    ).toBeTruthy();
    expect(screen.getByText("Download all results as:")).toBeTruthy();
    for (const [name, format] of [
      ["JSON", "json"],
      ["CSV", "csv"],
    ] as const) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(`${surveyPath}/results/export?format=${format}`);
      expect(link.hasAttribute("download")).toBe(true);
    }
    expect(screen.getByText(ACCESS_OFF)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Grant Access" })).toBeTruthy();
    expect(
      screen.getByText(
        "Toggle to store the IP addresses of your respondents along with other answers",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Respondent IP in Results" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete Results" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset Table State" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset Summary State" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Go to the results page" })).toBeNull();
  });

  it("hides the dates and Delete Results when there are no responses", async () => {
    server.use(...pageHandlers({ stats: NO_STATS }));

    renderApp(`${path}?tab=details`);

    expect(await screen.findByText("Total responses:")).toBeTruthy();
    expect(within(row("Total responses:")).getByText("0")).toBeTruthy();
    expect(screen.queryByText("First response at:")).toBeNull();
    expect(screen.queryByText("Last response at:")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Results" })).toBeNull();
    expect(screen.getByRole("link", { name: "JSON" })).toBeTruthy();
  });

  it("offers no toggles and no Delete Results to a caller who may not modify the survey", async () => {
    server.use(...pageHandlers({ survey: { ...sampleSurvey, permissions: { canModify: false } } }));

    renderApp(`${path}?tab=details`);

    expect(await screen.findByText("Total responses:")).toBeTruthy();
    expect(screen.getByRole("link", { name: "JSON" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "CSV" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset Table State" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset Summary State" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Grant Access" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save Respondent IP in Results" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Results" })).toBeNull();
  });

  it("grants access with one merge patch, disabled while it runs, then shows the link", async () => {
    const seen: { body: unknown; contentType: string | null }[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      patchHandler(
        seen,
        (body) =>
          HttpResponse.json(
            surveyWith({
              publicResults: (body.settings as { publicResults: boolean }).publicResults,
              storeRespondentIp: false,
            }),
          ),
        gate,
      ),
      ...pageHandlers(),
    );
    renderApp(`${path}?tab=details`);

    fireEvent.click(await screen.findByRole("button", { name: "Grant Access" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Grant Access" }).hasAttribute("disabled")).toBe(
        true,
      ),
    );
    release();
    expect(
      await screen.findByText(/Your Survey results can be accessible via direct Url\./),
    ).toBeTruthy();
    expect(seen).toEqual([
      {
        body: { settings: { publicResults: true } },
        contentType: "application/merge-patch+json",
      },
    ]);
    const link = screen.getByRole("link", { name: "Go to the results page" });
    expect(link.getAttribute("href")).toBe(`${window.location.origin}/results/${surveyId}`);
    expect(link.getAttribute("target")).toBe("_blank");

    fireEvent.click(screen.getByRole("button", { name: "Disable Access" }));
    await screen.findByRole("button", { name: "Grant Access" });
    expect(seen[1]!.body).toEqual({ settings: { publicResults: false } });
  });

  it("turns the IP setting on without reading the results or statistics again", async () => {
    const seen: { body: unknown; contentType: string | null }[] = [];
    server.use(
      patchHandler(seen, () =>
        HttpResponse.json(surveyWith({ publicResults: false, storeRespondentIp: true })),
      ),
      ...pageHandlers(),
    );
    renderApp(`${path}?tab=details`);
    await screen.findByText("Total responses:");
    const { requests } = record();

    fireEvent.click(screen.getByRole("button", { name: "Save Respondent IP in Results" }));

    expect(
      await screen.findByText(
        "The IP addresses of your respondents are stored along with other answers. Toggle not to store.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Do not save Respondent IP in Results" }),
    ).toBeTruthy();
    expect(seen[0]!.body).toEqual({ settings: { storeRespondentIp: true } });
    expect(requests.filter((request) => request.includes("/results"))).toEqual([]);
  });

  it("says when a setting could not be saved and leaves the button usable", async () => {
    server.use(patchHandler([], failing), ...pageHandlers());
    renderApp(`${path}?tab=details`);

    fireEvent.click(await screen.findByRole("button", { name: "Grant Access" }));

    expect((await screen.findByRole("alert")).textContent).toBe(PATCH_FAILED);
    expect(screen.getByText(ACCESS_OFF)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Grant Access" }).hasAttribute("disabled")).toBe(
      false,
    );
  });
});

describe("the Details tab: Delete Results", () => {
  it("asks for the survey name, then the confirm, then deletes and shows 0", async () => {
    let count = 3;
    const csrfs: (string | null)[] = [];
    server.use(
      deleteResultsHandler((csrf) => {
        csrfs.push(csrf);
        count = 0;
      }),
      ...pageHandlers({ stats: () => (count === 0 ? NO_STATS : STATS) }),
    );
    document.cookie = "msid_csrf=token-1";
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    const { count: requestCount } = record();
    renderApp(`${path}?tab=details`);

    fireEvent.click(await screen.findByRole("button", { name: "Delete Results" }));

    expect(screen.getByText(DELETE_WARNING)).toBeTruthy();
    const clear = screen.getByRole("button", { name: "Clear All Data" });
    expect(clear.hasAttribute("disabled")).toBe(true);
    const input = screen.getByPlaceholderText("Type the survey name");
    fireEvent.change(input, { target: { value: "customer feedback" } });
    expect(clear.hasAttribute("disabled")).toBe(true);
    fireEvent.change(input, { target: { value: sampleSurvey.name } });
    expect(clear.hasAttribute("disabled")).toBe(false);

    fireEvent.click(clear);
    expect(confirm).toHaveBeenCalledWith(DELETE_CONFIRM);
    expect(requestCount(`DELETE ${surveyPath}/results`)).toBe(0);

    fireEvent.click(clear);
    expect(await screen.findByText("All results are deleted.")).toBeTruthy();
    await waitFor(() => expect(within(row("Total responses:")).getByText("0")).toBeTruthy());
    expect(csrfs).toHaveLength(1);
    expect(csrfs[0]).toBe("token-1");
    expect(screen.queryByRole("button", { name: "Delete Results" })).toBeNull();
    expect(screen.queryByText("First response at:")).toBeNull();
    expect(requestCount(`GET ${surveyPath}/results/stats`)).toBe(2);

    const readsBefore = requestCount(`GET ${surveyPath}/results?limit=1000`);
    fireEvent.click(tab("Summary"));
    const summary = await screen.findByTestId("fake-summary");
    expect(within(summary).getByText("0 responses")).toBeTruthy();
    expect(requestCount(`GET ${surveyPath}/results?limit=1000`)).toBe(readsBefore);
  });

  it("says when the results could not be deleted and keeps the responses", async () => {
    server.use(mswHttp.delete(`*${surveyPath}/results`, failing), ...pageHandlers());
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp(`${path}?tab=details`);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Results" }));
    fireEvent.change(screen.getByPlaceholderText("Type the survey name"), {
      target: { value: sampleSurvey.name },
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear All Data" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The results could not be deleted. Please try again.",
    );
    fireEvent.click(tab("Summary"));
    expect(within(await screen.findByTestId("fake-summary")).getByText("3 responses")).toBeTruthy();
  });

  it("says when the statistics could not be loaded and tries again", async () => {
    let attempts = 0;
    server.use(
      mswHttp.get(`*${surveyPath}/results/stats`, () => {
        attempts += 1;
        return attempts === 1 ? failing() : HttpResponse.json(STATS);
      }),
      ...pageHandlers(),
    );
    renderApp(`${path}?tab=details`);

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(
        "The statistics could not be loaded. Check your connection and try again.",
      ),
    ).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Total responses:")).toBeTruthy();
    expect(within(row("Total responses:")).getByText("3")).toBeTruthy();
    expect(attempts).toBe(2);
  });
});

describe("the Summary's private questions", () => {
  it("hands the survey's private questions over and saves a new list with one patch", async () => {
    const seen: { body: unknown; contentType: string | null }[] = [];
    const survey = {
      ...sampleSurvey,
      settings: { ...sampleSurvey.settings, privateResultQuestions: ["q2"] },
    };
    server.use(
      patchHandler(seen, (body) =>
        HttpResponse.json({
          ...survey,
          settings: { ...survey.settings, ...(body.settings as object) },
        }),
      ),
      ...pageHandlers({ survey }),
    );
    renderApp(path);

    expect((await screen.findByTestId("fake-summary-private")).textContent).toBe('["q2"]');
    fireEvent.click(screen.getByRole("button", { name: "Make q1 private" }));

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({
      body: { settings: { privateResultQuestions: ["q1"] } },
      contentType: "application/merge-patch+json",
    });
  });

  it("gives a caller who may not modify the survey no toggle", async () => {
    server.use(...pageHandlers({ survey: { ...sampleSurvey, permissions: { canModify: false } } }));

    renderApp(path);

    await screen.findByTestId("fake-summary");
    expect(screen.queryByRole("button", { name: "Make q1 private" })).toBeNull();
    expect(screen.getByTestId("fake-summary-private").textContent).toBe("[]");
  });

  it("says when the list could not be saved", async () => {
    server.use(patchHandler([], failing), ...pageHandlers());
    renderApp(path);

    fireEvent.click(await screen.findByRole("button", { name: "Make q1 private" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The list of private questions could not be saved. Please try again.",
    );
  });

  it("gives the Table no toggle", async () => {
    server.use(...pageHandlers());

    renderApp(`${path}?tab=table`);

    await screen.findByTestId("fake-table");
    expect(screen.queryByRole("button", { name: "Make q1 private" })).toBeNull();
  });
});
