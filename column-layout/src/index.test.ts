import { describe, expect, it } from "vitest";
import { enumValue, privateNamesOfLayout, storedColumnEntries } from "./index.js";

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
