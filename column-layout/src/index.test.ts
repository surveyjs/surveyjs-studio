import { describe, expect, it } from "vitest";
import { enumValue, privateAnswers, privateNamesOfLayout, storedColumnEntries } from "./index.js";

const answers = ["a", "b", "c"];
const col = (name: string, visibility?: unknown) => ({ name, visibility });
const names = (layout: unknown, among: string[] = answers) =>
  privateNamesOfLayout(layout, among)?.sort();

describe("enumValue", () => {
  it("reads none, texts and whole numbers as the old reader did", () => {
    expect(enumValue(undefined)).toBe(0);
    expect(enumValue(null)).toBe(0);
    expect(enumValue(" 2 ")).toBe(2);
    expect(enumValue("x")).toBe(0);
    expect(enumValue(1)).toBe(1);
    expect(enumValue(1.5)).toBeUndefined();
    expect(enumValue(true)).toBeUndefined();
  });
});

describe("storedColumnEntries", () => {
  it("returns the objects and nulls, or the fault", () => {
    expect(storedColumnEntries([{ name: "a" }, null])).toEqual([{ name: "a" }, null]);
    expect(storedColumnEntries(undefined)).toEqual([]);
    expect(storedColumnEntries([1])).toBe("entry-no-object");
    expect(storedColumnEntries("x")).toBe("text");
    expect(storedColumnEntries("")).toEqual([]);
    expect(storedColumnEntries({ a: 1 })).toBe("object");
    expect(storedColumnEntries("d", { isDateText: () => true })).toEqual([]);
  });
});

describe("privateNamesOfLayout", () => {
  it("hides the listed columns that are hidden or not public", () => {
    const layout = { columns: [col("a", 0), col("b", 1), col("c", 2)], newcolumnsvisibility: 0 };
    expect(names(layout)).toEqual(["HappendAt", "InstanceId", "b", "c"]);
  });

  it("gives unlisted answers the new-columns visibility", () => {
    const layout = { columns: [col("a")], newcolumnsvisibility: 2 };
    expect(names(layout)).toEqual(["HappendAt", "InstanceId", "b", "c"]);
    expect(names({ columns: [col("a")], newcolumnsvisibility: 0 })).toEqual([
      "HappendAt",
      "InstanceId",
    ]);
    expect(names({ columns: [col("a")], newcolumnsvisibility: "1" })).toContain("b");
  });

  it("keeps HappendAt and InstanceId public only when the layout lists them shown", () => {
    const layout = { columns: [col("HappendAt", 0), col("InstanceId"), col("a")] };
    expect(names(layout)).toEqual([]);
    expect(names({ columns: [col("HappendAt", 1), col("a")] })).toEqual([
      "HappendAt",
      "InstanceId",
    ]);
  });

  it("lists a hidden question named like a response column (id, clientid, IPAddress)", () => {
    const layout = { columns: [col("IPAddress", 2), col("ClientId", 2), col("id", 1), col("a")] };
    expect(names(layout, ["id", "clientid", ...answers])).toEqual(
      ["ClientId", "HappendAt", "IPAddress", "InstanceId", "id"].sort(),
    );
    expect(names({ columns: [col("a")], newcolumnsvisibility: 2 }, ["id", "clientid"])).toEqual(
      ["HappendAt", "InstanceId", "clientid", "id"].sort(),
    );
  });

  it("hides nothing for a layout without columns", () => {
    expect(names({})).toEqual([]);
    expect(names({ columns: [], newcolumnsvisibility: 2 })).toEqual([]);
    expect(names({ columns: null, newcolumnsvisibility: 2 })).toEqual([]);
  });

  it("counts a nameless column as listed (the layout then has columns)", () => {
    expect(names({ columns: [null], newcolumnsvisibility: 2 })).toEqual([
      "HappendAt",
      "InstanceId",
      "a",
      "b",
      "c",
    ]);
  });

  it("is null for a layout the old calculation failed on", () => {
    expect(privateNamesOfLayout([], answers)).toBeNull();
    expect(privateNamesOfLayout({ columns: "x" }, answers)).toBeNull();
    expect(privateNamesOfLayout({ columns: [3] }, answers)).toBeNull();
    expect(privateNamesOfLayout({ columns: [col("a", true)] }, answers)).toBeNull();
    expect(
      privateNamesOfLayout({ columns: [col("a")], newcolumnsvisibility: 1.5 }, answers),
    ).toBeNull();
    expect(privateNamesOfLayout({ newcolumnsvisibility: {} }, answers)).toBeNull();
  });
});

describe("privateAnswers", () => {
  const sorted = (names: Iterable<string> | null | undefined) =>
    names ? [...names].sort() : names;
  const layout = {
    columns: [col("HappendAt", 0), col("a", 0), col("b", 2)],
    newcolumnsvisibility: 0,
  };

  it("without a layout, or one listing no columns, hides the list's private entries", () => {
    const list = [
      { name: "a", isPublic: false },
      { name: "b", isPublic: true },
    ];
    for (const noColumns of [undefined, {}, { columns: [], newcolumnsvisibility: 2 }]) {
      const result = privateAnswers(list, noColumns, answers);
      expect(result?.privateNames).toEqual(["a"]);
      expect(sorted(result?.publicNames)).toEqual(["HappendAt", "InstanceId", "b", "c"]);
      expect(result?.listedUnderPermissions).toBeNull();
    }
    expect(privateAnswers(undefined, undefined, answers)?.privateNames).toEqual([]);
  });

  it("with a layout and no list, hides what the layout rule hides", () => {
    const result = privateAnswers(undefined, layout, answers);
    expect(result?.privateNames).toEqual(privateNamesOfLayout(layout, answers));
    expect(sorted(result?.privateNames)).toEqual(["InstanceId", "b"]);
    expect(result?.listedUnderPermissions).toBeNull();
  });

  it("with both, keeps public only what the list marks public and the layout lists, at any visibility", () => {
    const list = [
      { name: "a", isPublic: true },
      { name: "b", isPublic: true },
      { name: "c", isPublic: true },
    ];
    const result = privateAnswers(list, layout, answers);
    // b is listed as hidden from public reads, yet public by the list; c is not listed.
    expect(sorted(result?.publicNames)).toEqual(["a", "b"]);
    expect(sorted(result?.privateNames)).toEqual(["HappendAt", "InstanceId", "c"]);
    expect(sorted(result?.listedUnderPermissions)).toEqual(["HappendAt", "a", "b"]);
  });

  it("with both, hides what the list does not mark public: an answer added later, a response-only key, the time and id", () => {
    // The old public results' case: q2 was added after the list was saved, k is only in responses.
    const list = [{ name: "q1", isPublic: true }];
    const both = {
      columns: [col("HappendAt", 0), col("q1", 0), col("q2", 0)],
      newcolumnsvisibility: 0,
    };
    const result = privateAnswers(list, both, ["q1", "q2", "k"]);
    expect(result?.publicNames).toEqual(["q1"]);
    expect(sorted(result?.privateNames)).toEqual(["HappendAt", "InstanceId", "k", "q2"]);
  });

  it("with both, applies a list of private entries only (as Studio wrote it) literally: nothing is public", () => {
    const result = privateAnswers([{ name: "b", isPublic: false }], layout, answers);
    expect(result?.publicNames).toEqual([]);
    expect(sorted(result?.privateNames)).toEqual(["HappendAt", "InstanceId", "a", "b", "c"]);
    expect(privateAnswers([], layout, answers)?.publicNames).toEqual([]);
  });

  it("with both, makes public only an entry with isPublic exactly true and no private entry of its name", () => {
    const list = [
      { name: "a", isPublic: "true" },
      { name: "b", isPublic: true },
      { name: "b", isPublic: false },
      { name: "HappendAt", isPublic: true },
      null,
      ["a"],
      { name: 1, isPublic: true },
    ];
    expect(privateAnswers(list, layout, answers)?.publicNames).toEqual(["HappendAt"]);
  });

  it("is null when the layout cannot be read, with a list or without", () => {
    expect(privateAnswers(undefined, [], answers)).toBeNull();
    expect(privateAnswers([], { columns: [col("a", true)] }, answers)).toBeNull();
    expect(privateAnswers([], null, answers)).toBeNull();
  });
});
