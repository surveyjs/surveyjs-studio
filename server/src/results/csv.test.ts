import { describe, expect, it } from "vitest";
import type { SurveyDefinition, SurveyResponse } from "../domain/types.js";
import { csvColumns, csvField, csvHeader, csvRecord, csvRow } from "./csv.js";

function response(overrides: Partial<SurveyResponse>): SurveyResponse {
  return {
    id: "r-1",
    submittedAt: "2026-04-01T10:30:00.000Z",
    data: {},
    partial: false,
    ...overrides,
  };
}

describe("csvField", () => {
  it.each([
    [null, ""],
    [undefined, ""],
    ["plain", "plain"],
    ["a,b", '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ["line1\nline2", '"line1\nline2"'],
    ["x\ry", '"x\ry"'],
    ["=SUM(A1)", "'=SUM(A1)"],
    ["+1", "'+1"],
    ["-1", "'-1"],
    ["@x", "'@x"],
    ["\tx", "'\tx"],
    ["\rx", '"\'\rx"'],
    [-5, "-5"],
    [0.5, "0.5"],
    [true, "true"],
    [["a", "b"], '"[""a"",""b""]"'],
    [{ row1: "col1" }, '"{""row1"":""col1""}"'],
    [
      [{ name: "r.png", type: "image/png", content: "http://x/api/v1/public/files/ab" }],
      '"[{""name"":""r.png"",""type"":""image/png"",""content"":""http://x/api/v1/public/files/ab""}]"',
    ],
    ["Ünïcødé 😀 日本", "Ünïcødé 😀 日本"],
  ])("formats %j as %j", (value, expected) => {
    expect(csvField(value)).toBe(expected);
  });
});

describe("csvRecord", () => {
  it("joins the fields and ends the record with CRLF", () => {
    expect(csvRecord(["a", 1, null])).toBe("a,1,\r\n");
  });
});

describe("csvColumns and csvRow", () => {
  const definition: SurveyDefinition = {
    pages: [
      {
        elements: [
          { type: "text", name: "q1", showCommentArea: true },
          { type: "text", name: "q2" },
        ],
      },
    ],
  };

  it("lists Submitted, IPAddress, the questions with their comment areas, then ClientId", () => {
    const columns = csvColumns(definition, { storeRespondentIp: true });
    expect(columns.map((column) => column.header)).toStrictEqual([
      "Submitted",
      "IPAddress",
      "q1",
      "q1-Comment",
      "q2",
      "ClientId",
    ]);
  });

  it("leaves out IPAddress when the survey does not store respondent IPs", () => {
    const columns = csvColumns(definition, { storeRespondentIp: false });
    expect(columns.map((column) => column.header)).not.toContain("IPAddress");
  });

  it("guards a question name that starts with a formula character in the header", () => {
    const columns = csvColumns(
      { elements: [{ type: "text", name: "=x" }] },
      { storeRespondentIp: false },
    );
    expect(csvHeader(columns)).toBe("Submitted,'=x,ClientId\r\n");
  });

  it("writes a row in column order and leaves out data keys that are not columns", () => {
    const columns = csvColumns(definition, { storeRespondentIp: true });
    const row = csvRow(
      columns,
      response({
        clientId: "c-1",
        respondentIp: "203.0.113.7",
        data: { q1: "x", "q1-Comment": "c", extra: 1 },
      }),
    );
    expect(row).toBe("2026-04-01T10:30:00.000Z,203.0.113.7,x,c,,c-1\r\n");
  });

  it("reads a question's answer from its valueName", () => {
    const columns = csvColumns(
      { elements: [{ type: "text", name: "q", valueName: "v" }] },
      { storeRespondentIp: false },
    );
    expect(csvRow(columns, response({ data: { v: "answer", q: "ignored" } }))).toBe(
      "2026-04-01T10:30:00.000Z,answer,\r\n",
    );
  });
});
