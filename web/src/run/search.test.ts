import { describe, expect, it } from "vitest";
import { localeOf, needsLocales, prefillValues, validateRunSearch } from "./search";

describe("validateRunSearch", () => {
  it("keeps every member as given, in a copy", () => {
    const raw = { id: "x", locale: "de", q1: "Ann", n: 3 };

    const search = validateRunSearch(raw);

    expect(search).toEqual(raw);
    expect(search).not.toBe(raw);
  });
});

describe("prefillValues", () => {
  it("lists every member except locale, with the parsed values", () => {
    expect(prefillValues({ locale: "de", q1: "Ann", n: 3, list: [1, 2] })).toEqual([
      ["q1", "Ann"],
      ["n", 3],
      ["list", [1, 2]],
    ]);
  });

  it("prefills id like any other answer", () => {
    expect(prefillValues({ id: "x", locale: "de", q1: "Ann" })).toEqual([
      ["id", "x"],
      ["q1", "Ann"],
    ]);
  });

  it("is empty without answers", () => {
    expect(prefillValues({ locale: "de" })).toEqual([]);
  });
});

describe("localeOf", () => {
  it.each([
    [{ locale: "de" }, "de"],
    [{ locale: "  fr " }, "fr"],
    [{ locale: "" }, undefined],
    [{ locale: "   " }, undefined],
    [{ locale: 3 }, undefined],
    [{ locale: null }, undefined],
    [{}, undefined],
  ])("%j → %j", (search, expected) => {
    expect(localeOf(search)).toBe(expected);
  });
});

describe("needsLocales", () => {
  it.each([
    ["en", false],
    ["EN", false],
    [undefined, false],
    ["de", true],
  ])("%j → %j", (locale, expected) => {
    expect(needsLocales(locale)).toBe(expected);
  });
});
