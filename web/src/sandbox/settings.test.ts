import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, loadSandboxSettings } from "./settings";

afterEach(() => vi.restoreAllMocks());

function load(value: unknown) {
  return loadSandboxSettings(() => Promise.resolve(value));
}

describe("loadSandboxSettings", () => {
  it("reads each setting", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await load({ maxUploadKb: 10, storageLimitKb: 20, seedBudgetKb: 30 })).toEqual({
      maxUploadKb: 10,
      storageLimitKb: 20,
      seedBudgetKb: 30,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("has the documented defaults", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      maxUploadKb: 200,
      storageLimitKb: 4096,
      seedBudgetKb: 1024,
    });
  });

  it("falls back entirely, with one warning, for a missing file", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const settings = await loadSandboxSettings(() => Promise.reject(new Error("404")));
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("falls back entirely for a non-JSON body and for a non-object", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await loadSandboxSettings(() => Promise.reject(new SyntaxError("bad json")))).toEqual(
      DEFAULT_SETTINGS,
    );
    for (const value of [null, [1], "x", 5]) expect(await load(value)).toEqual(DEFAULT_SETTINGS);
    expect(warn).toHaveBeenCalledTimes(5);
  });

  it("falls back for an invalid setting only, with a warning naming it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const settings = await load({ maxUploadKb: -5, storageLimitKb: 8000, seedBudgetKb: "200" });
    expect(settings).toEqual({ maxUploadKb: 200, storageLimitKb: 8000, seedBudgetKb: 1024 });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toContain("maxUploadKb");
    expect(String(warn.mock.calls[1]?.[0])).toContain("seedBudgetKb");
  });

  it("rejects zero and fractions", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await load({ maxUploadKb: 0, storageLimitKb: 1.5 })).toEqual(DEFAULT_SETTINGS);
  });

  it("ignores unknown keys", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await load({ maxUploadKb: 7, extra: true })).toEqual({
      ...DEFAULT_SETTINGS,
      maxUploadKb: 7,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
