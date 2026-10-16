import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HistoryPage as HistoryPageData } from "../api/content";
import { historyHandler } from "../test/content-handlers";
import { renderApp } from "../test/renderApp";
import { configHandler, meHandler, sampleSurvey, server, surveyHandler } from "../test/server";

const path = `/surveys/${sampleSurvey.id}/history`;
const ada = { id: "u1", displayName: "Ada Admin" };
const first: HistoryPageData = {
  items: [
    { at: "2026-10-03T10:00:00.000Z", user: ada },
    { at: "2026-10-02T10:00:00.000Z", user: null },
  ],
  nextCursor: "c2",
};
const second: HistoryPageData = {
  items: [{ at: "2026-10-01T10:00:00.000Z", user: { id: "u2", displayName: "Bob Builder" } }],
  nextCursor: null,
};

function open(pages: Record<string, HistoryPageData>) {
  server.use(configHandler(), meHandler(), surveyHandler(), historyHandler(pages));
  renderApp(path);
}

describe("the history page", () => {
  it("lists the entries in the server's order, with the user when known", async () => {
    open({ "": { ...first, nextCursor: null } });

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: `Survey editing history of the '${sampleSurvey.name}'`,
      }),
    ).toBeTruthy();
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toMatch(/by Ada Admin$/);
    expect(items[1]!.textContent).not.toContain(" by ");
    expect(items[0]!.querySelector("time")!.getAttribute("datetime")).toBe(first.items[0]!.at);
    expect(items[0]!.querySelector("time")!.textContent).toMatch(/\d{4}|\d\/\d/);
    expect(screen.queryByText("Show more")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to My Surveys" })).toBeTruthy();
  });

  it("loads the next page on Show more and hides it at the end", async () => {
    open({ "": first, c2: second });

    fireEvent.click(await screen.findByText("Show more"));

    expect(await screen.findByText(/by Bob Builder/)).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText("Show more")).toBeNull();
  });

  it("says so when there are no edits", async () => {
    open({ "": { items: [], nextCursor: null } });

    expect(await screen.findByText("No edits yet.")).toBeTruthy();
  });

  it("offers a retry when the first load fails", async () => {
    open({});

    expect(await screen.findByText(/Could not load the history. Please try again./)).toBeTruthy();
    server.use(historyHandler({ "": { ...first, nextCursor: null } }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText(/by Ada Admin/)).toBeTruthy();
    expect(screen.queryByText(/Could not load the history/)).toBeNull();
  });

  it("keeps the loaded entries when the next page fails and retries on Show more", async () => {
    open({ "": first });

    fireEvent.click(await screen.findByText("Show more"));

    expect(await screen.findByText("Could not load more entries. Please try again.")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    server.use(historyHandler({ "": first, c2: second }));
    fireEvent.click(screen.getByText("Show more"));

    expect(await screen.findByText(/by Bob Builder/)).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText(/Could not load more entries/)).toBeNull();
  });

  it("says the survey is not available for an unknown survey", async () => {
    server.use(configHandler(), meHandler(), surveyHandler(), historyHandler({}));
    renderApp("/surveys/22222222-0000-4000-8000-000000000002/history");

    expect(await screen.findByText("This survey is not available.")).toBeTruthy();
  });
});
