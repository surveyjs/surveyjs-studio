import { describe, expect, it } from "vitest";
import {
  REFERENCE_SETTINGS,
  referenceEnv,
} from "../../conformance-tests/src/reference-settings.js";
import { UsageError, parseConformanceArgs, suiteCommand } from "./args.js";

describe("parseConformanceArgs", () => {
  it("reads --base <url>", () => {
    expect(parseConformanceArgs(["--base", "http://127.0.0.1:3000"])).toEqual({
      baseUrl: "http://127.0.0.1:3000",
      rest: [],
    });
  });

  it("reads --base=<url> and strips a trailing slash", () => {
    expect(parseConformanceArgs(["--base=http://h:1/"]).baseUrl).toBe("http://h:1");
  });

  it("drops one leading -- (pnpm runs the root script as cli.ts -- --base url)", () => {
    expect(parseConformanceArgs(["--", "--base", "http://h:1"])).toEqual({
      baseUrl: "http://h:1",
      rest: [],
    });
  });

  it("gives null without --base", () => {
    expect(parseConformanceArgs([])).toEqual({ baseUrl: null, rest: [] });
  });

  it("refuses a /api/v1 path, which the suite adds itself", () => {
    expect(() => parseConformanceArgs(["--base", "http://h/api/v1"])).toThrow(/without \/api\/v1/);
  });

  it("refuses --base without a value", () => {
    expect(() => parseConformanceArgs(["--base"])).toThrow(UsageError);
    expect(() => parseConformanceArgs(["--base", "-t"])).toThrow(UsageError);
  });

  it("refuses a URL that is not http or https", () => {
    expect(() => parseConformanceArgs(["--base", "ftp://h"])).toThrow(UsageError);
    expect(() => parseConformanceArgs(["--base", "nonsense"])).toThrow(UsageError);
  });

  it("passes the other arguments through in order", () => {
    expect(parseConformanceArgs(["-t", "surveys", "--base", "http://h:1"])).toEqual({
      baseUrl: "http://h:1",
      rest: ["-t", "surveys"],
    });
  });
});

describe("referenceEnv", () => {
  it("is the settings plus the address", () => {
    const env = referenceEnv(3000);
    expect(env).toMatchObject({
      ...REFERENCE_SETTINGS,
      HOST: "127.0.0.1",
      PORT: "3000",
      PUBLIC_BASE_URL: "http://127.0.0.1:3000",
    });
    expect(env.IDENTITY_PROVIDER).toBe("dev");
    expect(env.MEMORY_SEED).toBe("legacy-fixtures");
  });
});

describe("suiteCommand", () => {
  it("passes the arguments after the script name, without a -- (Vitest would read them as filters)", () => {
    expect(suiteCommand(["-t", "surveys"])).toEqual([
      "--filter",
      "@surveyjs-studio/conformance-tests",
      "test",
      "-t",
      "surveys",
    ]);
  });

  it("is just the script without arguments", () => {
    expect(suiteCommand([])).not.toContain("--");
  });
});
