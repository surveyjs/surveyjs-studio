import { describe, expect, it } from "vitest";
import { validateFixtureTables } from "../../legacy/table-validation.js";
import { largeSurveyTable } from "./large-survey.js";

const entities = largeSurveyTable().entities;
const entity = (n: number) => entities[n - 1]!;
const answers = (n: number): unknown => JSON.parse(String(entity(n).result));

describe("largeSurveyTable", () => {
  it("is the results table of the post, with 1,500 entities in response order", () => {
    const table = largeSurveyTable();
    expect(table.account).toBe("results");
    expect(table.name).toBe("post33333333000040008000a00000000008");
    expect(entities).toHaveLength(1500);
    expect(entities.map((e) => e.id)).toEqual(
      Array.from(
        { length: 1500 },
        (_, i) => `66666666-0000-4000-8000-c${(i + 1).toString(16).padStart(11, "0")}`,
      ),
    );
  });

  it("uses unique GUID row keys equal to the id", () => {
    expect(new Set(entities.map((e) => e.RowKey)).size).toBe(1500);
    for (const e of entities) expect(e.RowKey).toBe(e.id);
  });

  it.each([
    [
      1,
      "…c00000000001",
      "2026-05-01T08:00:00.000Z",
      { color: "Red", score: 1, subscribe: false, channels: ["Search"] },
    ],
    [
      2,
      "…c00000000002",
      "2026-05-01T08:01:00.000Z",
      { color: "Green", score: 2, subscribe: false, channels: ["Friend"] },
    ],
    [
      500,
      "…c000000001f4",
      "2026-05-01T12:10:00.000Z",
      { color: "Green", score: 5, subscribe: true, channels: ["Ad"], comment: "Comment 500" },
    ],
    [
      501,
      "…c000000001f5",
      "2026-05-01T12:10:00.000Z",
      { color: "Blue", score: 1, subscribe: false, channels: ["Search"] },
    ],
    [
      1000,
      "…c000000003e8",
      "2026-05-01T16:20:00.000Z",
      { color: "Red", score: 5, subscribe: true, channels: ["Ad"], comment: "Comment 1000" },
    ],
    [
      1001,
      "…c000000003e9",
      "2026-05-01T16:20:00.000Z",
      { color: "Green", score: 1, subscribe: false, channels: ["Search"] },
    ],
    [
      1500,
      "…c000000005dc",
      "2026-05-01T20:30:00.000Z",
      { color: "Blue", score: 5, subscribe: true, channels: ["Ad"], comment: "Comment 1500" },
    ],
  ])("holds response %i as specified", (n, idEnd, happendat, expected) => {
    expect(entity(n).id).toBe(`66666666-0000-4000-8000-${idEnd.slice(1)}`);
    expect(entity(n).happendat).toBe(happendat);
    expect(answers(n)).toEqual(expected);
  });

  it("writes the answers in the key order of the legacy text", () => {
    expect(entity(1).result).toBe(
      '{"color":"Red","score":1,"subscribe":false,"channels":["Search"]}',
    );
  });

  it("has the shape of a legacy result entity", () => {
    expect(entity(3)).toEqual({
      PartitionKey: "*",
      RowKey: "66666666-0000-4000-8000-c00000000003",
      "id@odata.type": "Edm.Guid",
      id: "66666666-0000-4000-8000-c00000000003",
      type: "SURVEY_POSTRESUTL",
      "happendat@odata.type": "Edm.DateTime",
      happendat: "2026-05-01T08:01:00.000Z",
      "surveyid@odata.type": "Edm.Guid",
      surveyid: "77777777-0000-4000-8000-c00000000003",
      "postid@odata.type": "Edm.Guid",
      postid: "33333333-0000-4000-8000-a00000000008",
      result: '{"color":"Blue","score":3,"subscribe":false,"channels":["Search","Social"]}',
    });
  });

  it("has the exact distribution", () => {
    const rows = entities.map((_, i) => answers(i + 1) as Record<string, unknown>);
    const count = (key: string, value: unknown) =>
      rows.filter((r) =>
        Array.isArray(r[key]) ? (r[key] as unknown[]).includes(value) : r[key] === value,
      ).length;
    expect(["Red", "Green", "Blue"].map((c) => count("color", c))).toEqual([500, 500, 500]);
    expect([1, 2, 3, 4, 5].map((s) => count("score", s))).toEqual([300, 300, 300, 300, 300]);
    expect([count("subscribe", true), count("subscribe", false)]).toEqual([375, 1125]);
    expect(["Search", "Friend", "Social", "Ad"].map((c) => count("channels", c))).toEqual([
      750, 375, 375, 375,
    ]);
    expect(rows.filter((r) => r.comment !== undefined)).toHaveLength(150);
  });

  it("passes the fixture table validation", () => {
    expect(validateFixtureTables([largeSurveyTable()])).toEqual([]);
  });

  it("gives equal tables on every call", () => {
    expect(largeSurveyTable()).toEqual(largeSurveyTable());
  });
});
