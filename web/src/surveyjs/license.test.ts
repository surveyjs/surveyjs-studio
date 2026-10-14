import { beforeEach, describe, expect, it, vi } from "vitest";

const setLicenseKey = vi.fn();
vi.mock("survey-core", () => ({ setLicenseKey }));

beforeEach(() => {
  setLicenseKey.mockClear();
  vi.resetModules();
});

async function load() {
  return (await import("./license")).applySurveyJSLicense;
}

describe("applySurveyJSLicense", () => {
  it("sets the licence key in survey-core", async () => {
    await (
      await load()
    )("my-key");

    expect(setLicenseKey).toHaveBeenCalledExactlyOnceWith("my-key");
  });

  it("does nothing without a key", async () => {
    await (
      await load()
    )(null);

    expect(setLicenseKey).not.toHaveBeenCalled();
  });

  it("sets the key only once", async () => {
    const apply = await load();
    await apply("my-key");
    await apply("my-key");

    expect(setLicenseKey).toHaveBeenCalledTimes(1);
  });
});
