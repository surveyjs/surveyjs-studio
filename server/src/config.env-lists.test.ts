import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENV_VARIABLES } from "./config.js";

const lists = ["conformance-tests/src/global-setup.ts", "e2e/app-variables.mjs"];

describe("ENV_VARIABLES", () => {
  it.each(lists)("is named in %s", (file) => {
    const text = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    const missing = ENV_VARIABLES.filter((name) => !text.includes(`"${name}"`));
    expect(missing).toEqual([]);
  });
});
