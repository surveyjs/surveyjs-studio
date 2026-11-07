import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Survey, SurveyPage } from "../api/surveys";
import { renderApp } from "../test/renderApp";
import {
  configHandler,
  meHandler,
  projectsHandler,
  sampleSurvey,
  server,
  surveysHandler,
} from "../test/server";

const named = (n: number): Survey => ({
  ...sampleSurvey,
  id: `11111111-0000-4000-8000-00000000000${n}`,
  name: `Survey ${n}`,
});
const first: SurveyPage = { items: [named(1)], nextCursor: "c2" };
const second: SurveyPage = { items: [named(2)], nextCursor: "c3" };
const third: SurveyPage = { items: [named(3)], nextCursor: null };

function open(pages: Record<string, SurveyPage>, onRequest?: (url: URL) => void) {
  server.use(
    configHandler(),
    meHandler(),
    surveysHandler(pages, onRequest),
    projectsHandler({ "": { items: [], nextCursor: null } }),
  );
  renderApp("/?project=personal");
}

describe("the My Surveys list", () => {
  it("loads every page by itself, so the browser's Find sees the whole list", async () => {
    open({ "": first, c2: second, c3: third });

    expect(await screen.findByText("Survey 3")).toBeTruthy();
    expect(screen.getByText("Survey 1")).toBeTruthy();
    expect(screen.getByText("Survey 2")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    const list = document.querySelector(".v2-class---my-surveys-page__list");
    expect(list?.getAttribute("aria-busy")).toBe("false");
  });

  it("keeps the loaded surveys when a page fails, and retries it on Load more only", async () => {
    const cursors: string[] = [];
    open({ "": first }, (url) => {
      const cursor = url.searchParams.get("cursor");
      if (cursor !== null) cursors.push(cursor);
    });

    expect(await screen.findByText("Could not load more surveys. Please try again.")).toBeTruthy();
    expect(screen.getByText("Survey 1")).toBeTruthy();
    // A failed page is not fetched again on its own.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cursors).toEqual(["c2"]);

    server.use(surveysHandler({ "": first, c2: second, c3: third }));
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Survey 3")).toBeTruthy();
    expect(screen.queryByText(/Could not load more surveys/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
