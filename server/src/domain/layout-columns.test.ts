import { describe, expect, it } from "vitest";
import { hiddenAnswerColumns } from "./layout-columns.js";

describe("hiddenAnswerColumns", () => {
  it("lists columns that are hidden or hidden from public reads", () => {
    const text = JSON.stringify({
      columns: [
        { name: "a", visibility: 0 },
        { name: "b", visibility: 1 },
        { name: "c", visibility: 2 },
        { name: "d" },
        { name: "e", visibility: "2" },
        { name: "b", visibility: 1 },
      ],
    });
    expect(hiddenAnswerColumns(text)).toEqual(["b", "c", "e"]);
  });

  it("leaves out the system columns and nameless columns", () => {
    const text = JSON.stringify({
      columns: [
        { name: "HappendAt", visibility: 1 },
        { name: "IPAddress", visibility: 2 },
        { name: "ClientId", visibility: 2 },
        { visibility: 1 },
        null,
      ],
    });
    expect(hiddenAnswerColumns(text)).toEqual([]);
  });

  it("reads a layout without columns as hiding nothing and strips a BOM", () => {
    expect(hiddenAnswerColumns("{}")).toEqual([]);
    expect(hiddenAnswerColumns('\uFEFF{"columns":[{"name":"x","visibility":1}]}')).toEqual(["x"]);
  });

  it("is null for text that is no layout", () => {
    expect(hiddenAnswerColumns("not json")).toBeNull();
    expect(hiddenAnswerColumns("[]")).toBeNull();
    expect(hiddenAnswerColumns('{"columns":"x"}')).toBeNull();
    expect(hiddenAnswerColumns('{"columns":[1]}')).toBeNull();
    expect(hiddenAnswerColumns('{"columns":[{"name":"a","visibility":true}]}')).toBeNull();
  });
});
