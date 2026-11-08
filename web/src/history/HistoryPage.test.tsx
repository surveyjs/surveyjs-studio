import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryPage as HistoryPageData } from "../api/content";
import { historyEntryHandler, historyHandler } from "../test/content-handlers";
import { renderApp } from "../test/renderApp";
import { configHandler, meHandler, sampleSurvey, server, surveyHandler } from "../test/server";

const path = `/surveys/${sampleSurvey.id}/history`;
const ada = { id: "u1", displayName: "Ada Admin" };
const first: HistoryPageData = {
  items: [
    { id: "e3", at: "2026-10-03T10:00:00.000Z", user: ada },
    { id: "e2", at: "2026-10-02T10:00:00.000Z", user: null },
  ],
  nextCursor: "c2",
};
const second: HistoryPageData = {
  items: [
    { id: "e1", at: "2026-10-01T10:00:00.000Z", user: { id: "u2", displayName: "Bob Builder" } },
  ],
  nextCursor: null,
};

const saved = { title: "Then", pages: [{ name: "page1" }] };
const savedText = JSON.stringify(saved, null, 2);
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

function open(pages: Record<string, HistoryPageData>) {
  server.use(configHandler(), meHandler(), surveyHandler(), historyHandler(pages));
  renderApp(path);
}

/** The toggle of the first entry ("… by Ada Admin"), once the list is shown. */
const firstToggle = () => screen.findByRole("button", { name: /by Ada Admin/ });

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

  it("shows an entry's JSON on click, reads it once and hides it on the next click", async () => {
    const requested: string[] = [];
    server.use(historyEntryHandler({ e3: saved }, (entryId) => requested.push(entryId)));
    open({ "": { ...first, nextCursor: null } });
    const toggle = await firstToggle();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);

    const json = await screen.findByText((_, element) => element?.tagName === "CODE");
    expect(json.textContent).toBe(savedText);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Copy JSON" })).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Copy JSON" })).toBeNull();

    fireEvent.click(toggle);
    expect(await screen.findByRole("button", { name: "Copy JSON" })).toBeTruthy();
    expect(requested).toEqual(["e3"]);
  });

  it("copies the entry's JSON and says so", async () => {
    server.use(historyEntryHandler({ e3: saved }));
    open({ "": { ...first, nextCursor: null } });
    fireEvent.click(await firstToggle());

    fireEvent.click(await screen.findByRole("button", { name: "Copy JSON" }));

    expect(writeText).toHaveBeenCalledWith(savedText);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("shows a clipboard failure", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    server.use(historyEntryHandler({ e3: saved }));
    open({ "": { ...first, nextCursor: null } });
    fireEvent.click(await firstToggle());

    fireEvent.click(await screen.findByRole("button", { name: "Copy JSON" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Could not copy to the clipboard.");
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("says so when an entry's JSON cannot be loaded and tries again on the next open", async () => {
    server.use(historyEntryHandler({}));
    open({ "": { ...first, nextCursor: null } });
    const toggle = await firstToggle();
    fireEvent.click(toggle);

    const item = screen.getAllByRole("listitem")[0]!;
    expect((await within(item).findByRole("alert")).textContent).toBe(
      "Could not load this version. Please try again.",
    );

    server.use(historyEntryHandler({ e3: saved }));
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(await within(item).findByRole("button", { name: "Copy JSON" })).toBeTruthy();
    expect(within(item).queryByRole("alert")).toBeNull();
  });

  it("gives the sandbox's reason when an older entry kept no JSON, without asking to try again", async () => {
    server.use(historyEntryHandler({}, undefined, ["e3"]));
    open({ "": { ...first, nextCursor: null } });
    fireEvent.click(await firstToggle());

    const item = screen.getAllByRole("listitem")[0]!;
    expect((await within(item).findByRole("alert")).textContent).toBe(
      "The demo keeps the JSON of the 20 newest saves of a survey.",
    );
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
