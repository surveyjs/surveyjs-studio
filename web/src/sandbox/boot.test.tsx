import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootSandbox, START_TIMEOUT_TEXT, UNSUPPORTED_TEXT } from "./boot";
import { RESET_FAILED_TEXT } from "./SandboxOutdated";

let root: HTMLElement;
let unmount: (() => void) | undefined;

beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  act(() => unmount?.());
  unmount = undefined;
  root.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function boot(options: Partial<Parameters<typeof bootSandbox>[0]> = {}) {
  const reload = vi.fn();
  const reset = vi.fn();
  let booted: boolean | undefined;
  await act(async () => {
    const result = await bootSandbox({
      root,
      start: async () => "started",
      reset,
      reload,
      timeoutMs: 1000,
      ...options,
    });
    booted = result.booted;
    unmount = result.unmount;
  });
  return { booted, reload, reset };
}

describe("bootSandbox", () => {
  it("lets the app render once the sandbox has started", async () => {
    const { booted } = await boot();
    expect(booted).toBe(true);
    expect(root.childElementCount).toBe(0);
  });

  it("says so, with Try again, when the start never settles", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    let result: Awaited<ReturnType<typeof bootSandbox>> | undefined;
    await act(async () => {
      const pending = bootSandbox({
        root,
        start: () => new Promise(() => {}),
        reset: vi.fn(),
        reload,
        timeoutMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(1000);
      result = await pending;
    });
    unmount = result?.unmount;
    expect(result?.booted).toBe(false);
    expect(within(root).getByRole("alert").textContent).toBe(START_TIMEOUT_TEXT);
    fireEvent.click(within(root).getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("names what the demo needs, with Try again, when the start fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { booted, reload } = await boot({
      start: () => Promise.reject(new Error("no service workers")),
    });
    expect(booted).toBe(false);
    expect(within(root).getByRole("alert").textContent).toBe(UNSUPPORTED_TEXT);
    expect(error).toHaveBeenCalled();
    fireEvent.click(within(root).getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("offers a reset for data of another version, then reloads", async () => {
    const { booted, reset, reload } = await boot({ start: async () => "outdated" });
    expect(booted).toBe(false);
    expect(screen.getByRole("heading", { name: "This demo has been updated" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset to continue" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("says so, and does not reload, when the reset fails", async () => {
    const reset = vi.fn(() => {
      throw new Error("QuotaExceededError");
    });
    const { reload } = await boot({ start: async () => "outdated", reset });
    fireEvent.click(screen.getByRole("button", { name: "Reset to continue" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(RESET_FAILED_TEXT);
  });
});
