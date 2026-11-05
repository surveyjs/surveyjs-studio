import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigateTo } from "../navigation";
import { STORAGE_FULL_EVENT } from "./handlers/problems";
import { SandboxBanner } from "./SandboxBanner";
import seedJson from "./seed.json";
import type { SandboxSeed } from "./seed-types";
import { DEFAULT_SETTINGS } from "./settings";
import { createSandboxStore, memoryStorage, type SandboxStore } from "./store";

vi.mock("../navigation", () => ({ navigateTo: vi.fn() }));
let store: SandboxStore;
vi.mock("./start", () => ({ sandboxStore: () => store }));

const seed = seedJson as unknown as SandboxSeed;
const make = (storageLimitKb = DEFAULT_SETTINGS.storageLimitKb) =>
  createSandboxStore({
    storage: memoryStorage(),
    seed,
    settings: { ...DEFAULT_SETTINGS, storageLimitKb },
  });

const DEMO = "This is a demo. Your data stays in this browser, and other visitors don't see it.";
const FULL = "Browser storage is full. Reset the demo data to continue.";

beforeEach(() => {
  store = make();
  vi.mocked(navigateTo).mockClear();
  document.cookie = "msid=u1; path=/";
});
afterEach(() => {
  document.cookie = "msid=; path=/; max-age=0";
});

describe("SandboxBanner", () => {
  it("shows the demo text and the two links", () => {
    render(<SandboxBanner />);

    expect(screen.getByText(DEMO)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Run it yourself" }).getAttribute("href")).toBe(
      "https://github.com/surveyjs/surveyjs-studio/blob/master/docs/self-hosting.md",
    );
    expect(screen.getByRole("link", { name: "Source code" }).getAttribute("href")).toBe(
      "https://github.com/surveyjs/surveyjs-studio",
    );
    expect(screen.getByRole("button", { name: "Reset demo data" })).toBeTruthy();
  });

  it("asks before resetting, and Cancel keeps the data", () => {
    const reset = vi.spyOn(store, "reset");
    render(<SandboxBanner />);

    fireEvent.click(screen.getByRole("button", { name: "Reset demo data" }));
    expect(
      screen.getByText("Reset all demo data? Your changes in this browser are lost."),
    ).toBeTruthy();
    expect(reset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(reset).not.toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();
    expect(document.cookie).toContain("msid=u1");
    expect(screen.getByRole("button", { name: "Reset demo data" })).toBeTruthy();
  });

  it("reseeds, clears the session and reloads at sign-in on Reset", () => {
    store.write((data) => {
      data.surveys[0]!.name = "Changed";
    });
    render(<SandboxBanner />);

    fireEvent.click(screen.getByRole("button", { name: "Reset demo data" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(store.read().surveys[0]!.name).toBe(seed.surveys[0]!.name);
    expect(document.cookie).not.toContain("msid=u1");
    expect(navigateTo).toHaveBeenCalledExactlyOnceWith("/sign-in");
  });

  it("shows a message instead of crashing when the reset fails", () => {
    vi.spyOn(store, "reset").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    render(<SandboxBanner />);

    fireEvent.click(screen.getByRole("button", { name: "Reset demo data" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    const message = screen.getByText(
      "Could not reset the demo data. Clear this site's data in the browser and reload.",
    );
    expect(message.getAttribute("role")).toBe("alert");
    expect(message.closest("aside")!.querySelector("[role=alert] [role=alert]")).toBeNull();
    expect(document.activeElement).toBe(message);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("is a labelled landmark and announces the full-storage text in a live region", () => {
    render(<SandboxBanner />);

    const banner = screen.getByRole("complementary", { name: "Demo notice" });
    expect(banner.getAttribute("role")).toBeNull();
    const alert = within(banner).getByRole("alert");
    expect(alert.textContent).toBe("");

    act(() => {
      window.dispatchEvent(new Event(STORAGE_FULL_EVENT));
    });

    expect(within(banner).getByRole("alert").textContent).toBe(FULL);
  });

  it("keeps the focus in the banner: on Reset, then on Reset demo data after Cancel", () => {
    render(<SandboxBanner />);

    fireEvent.click(screen.getByRole("button", { name: "Reset demo data" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reset" }));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reset demo data" }));
  });

  it("shows the full-storage text when the storage is full at the start", () => {
    store = make(1);
    store.read();
    render(<SandboxBanner />);

    expect(screen.getByText(FULL)).toBeTruthy();
    expect(screen.queryByText(DEMO)).toBeNull();
    expect(screen.getByRole("button", { name: "Reset demo data" })).toBeTruthy();
  });

  it("shows the full-storage text on the storage-full event", () => {
    render(<SandboxBanner />);
    expect(screen.queryByText(FULL)).toBeNull();

    act(() => {
      window.dispatchEvent(new Event(STORAGE_FULL_EVENT));
    });

    expect(screen.getByText(FULL)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset demo data" })).toBeTruthy();
  });

  it("keeps the full-storage text on window focus while writes are still refused", () => {
    render(<SandboxBanner />);
    act(() => {
      window.dispatchEvent(new Event(STORAGE_FULL_EVENT));
    });

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(screen.getByText(FULL)).toBeTruthy();
  });

  it("clears the full-storage text after the next write is stored", () => {
    store = make(1);
    store.read();
    render(<SandboxBanner />);
    expect(screen.getByText(FULL)).toBeTruthy();

    store = make();
    act(() => {
      store.write((data) => data);
    });

    expect(screen.queryByText(FULL)).toBeNull();
    expect(screen.getByText(DEMO)).toBeTruthy();
  });

  it("is compact without the links on the run page", () => {
    render(<SandboxBanner compact />);

    expect(screen.getByText(DEMO)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Source code" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reset demo data" })).toBeTruthy();
  });
});
