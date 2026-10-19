import { fireEvent, screen, within } from "@testing-library/react";
import { HttpResponse, http as mswHttp } from "msw";
import { describe, expect, it, vi } from "vitest";
import {
  publicResultPagesHandler,
  publicResultsProblemHandler,
  samplePublishedSurvey,
} from "./test/public-handlers";
import { renderApp } from "./test/renderApp";
import { configHandler, server } from "./test/server";

// jsdom runs neither the Dashboard's charts nor Tabulator: the fakes show what the page passes.
vi.mock("./results/SummaryView", async () => {
  const { fakeResultsWidget } = await import("./test/fakeResultsWidget");
  return { SummaryView: fakeResultsWidget("fake-summary") };
});
vi.mock("./results/TableView", async () => {
  const { fakeResultsWidget } = await import("./test/fakeResultsWidget");
  return { TableView: fakeResultsWidget("fake-table") };
});

const surveyId = samplePublishedSurvey.id;
const path = `/results/${surveyId}`;
const NOT_AVAILABLE = "These survey results are not available.";
const FAILED = "The results could not be loaded. Check your connection and try again.";
const survey = {
  id: surveyId,
  name: "Shared survey",
  definition: samplePublishedSurvey.definition,
  privateQuestions: ["q2"],
};
const pages = [
  [
    { submittedAt: "2026-01-01T00:01:00.000Z", data: { q1: 1 } },
    { submittedAt: "2026-01-01T00:02:00.000Z", data: { q1: 2 } },
  ],
  [{ submittedAt: "2026-01-01T00:03:00.000Z", data: { q1: 3 } }],
];

/** Records `METHOD /path?query` of every API request. */
function recordRequests() {
  const requests: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    requests.push(`${request.method} ${url.pathname}${url.search}`);
  };
  server.events.on("request:start", listener);
  return { requests, stop: () => server.events.removeListener("request:start", listener) };
}

describe("the public results page", () => {
  it("shows the Summary of a survey with public results, without sign-in", async () => {
    const seen = recordRequests();
    server.use(configHandler(), publicResultPagesHandler(survey, pages));

    renderApp(path);

    expect(await screen.findByRole("heading", { level: 1, name: "Shared survey" })).toBeTruthy();
    const summary = await screen.findByTestId("fake-summary");
    expect(within(summary).getByText("3 responses")).toBeTruthy();
    expect(screen.getByTestId("fake-summary-private").textContent).toBe('["q2"]');
    expect(screen.getByTestId("fake-summary-public").textContent).toBe("true");
    expect(within(summary).queryByRole("button", { name: "Change layout" })).toBeNull();
    expect(within(summary).queryByRole("button", { name: "Make q1 private" })).toBeNull();
    expect(screen.getByRole("link", { name: "Summary" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Table" }).getAttribute("aria-current")).toBeNull();
    expect(screen.queryByRole("link", { name: "Details" })).toBeNull();
    expect(screen.queryByText("Download all results as:")).toBeNull();
    expect(document.title).toBe("Shared survey");
    expect(seen.requests).toEqual([
      "GET /api/v1/config",
      `GET /api/v1/public/surveys/${surveyId}/results?limit=1000`,
      `GET /api/v1/public/surveys/${surveyId}/results?limit=1000&cursor=c1`,
    ]);
    seen.stop();
  });

  it("shows the Table on its tab", async () => {
    server.use(configHandler(), publicResultPagesHandler(survey, pages));

    renderApp(path);
    await screen.findByTestId("fake-summary");
    fireEvent.click(screen.getByRole("link", { name: "Table" }));

    const table = await screen.findByTestId("fake-table");
    expect(within(table).getByText("3 responses")).toBeTruthy();
    expect(screen.queryByTestId("fake-summary")).toBeNull();
    expect(screen.getByRole("link", { name: "Table" }).getAttribute("aria-current")).toBe("page");
  });

  it("names the page Results when the survey has no name", async () => {
    server.use(configHandler(), publicResultPagesHandler({ ...survey, name: "" }, pages));

    renderApp(path);

    await screen.findByTestId("fake-summary");
    expect(document.title).toBe("Results");
  });

  it.each([
    [404, "survey-not-available"],
    [400, "bad-request"],
  ])("says the results are not available on a %i", async (status, code) => {
    server.use(configHandler(), publicResultsProblemHandler(status, code));

    renderApp(path);

    expect(await screen.findByText(NOT_AVAILABLE)).toBeTruthy();
    expect(document.title).toBe("Results not available");
  });

  it("offers Try again after a failure", async () => {
    server.use(configHandler(), publicResultsProblemHandler(429, "rate-limited"));

    renderApp(path);

    expect(await screen.findByText(FAILED)).toBeTruthy();
    server.use(
      mswHttp.get("*/api/v1/public/surveys/:surveyId/results", () =>
        HttpResponse.json({ survey, items: pages[0], nextCursor: null }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    const summary = await screen.findByTestId("fake-summary");
    expect(within(summary).getByText("2 responses")).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});
