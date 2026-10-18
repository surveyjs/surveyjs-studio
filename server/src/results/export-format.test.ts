import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { exportFileName, negotiateExportFormat, notAcceptable } from "./export-format.js";

describe("negotiateExportFormat", () => {
  it.each([
    ["csv", "application/json", "csv"],
    [undefined, undefined, "json"],
    [undefined, "", "json"],
    [undefined, "application/json", "json"],
    [undefined, "*/*", "json"],
    [undefined, "application/*", "json"],
    [undefined, "Application/JSON; charset=utf-8", "json"],
    [undefined, "text/csv", "csv"],
    [undefined, "text/*", "csv"],
    [undefined, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "json"],
    [undefined, "text/csv;q=0.5, application/json", "json"],
    [undefined, "application/json;q=0.2, text/csv;q=0.9", "csv"],
    [undefined, "text/csv;q=0, application/json;q=0.1", "json"],
    [undefined, "application/xml", null],
    [undefined, "image/png", null],
    [undefined, "text/csv;q=0", null],
    [undefined, "text/csv;q=abc", null],
  ] as const)("format %s with Accept %s is %s", (format, accept, expected) => {
    expect(negotiateExportFormat(format, accept)).toBe(expected);
  });
});

describe("exportFileName", () => {
  it.each([
    ["Customer feedback", "json", "Customer feedback.json"],
    ["  ", "csv", "results.csv"],
    ["", "json", "results.json"],
    ["a\u0007b", "csv", "ab.csv"],
    ["x\ud800", "csv", "x�.csv"],
  ] as const)("names %j as %j with %s", (name, format, expected) => {
    expect(exportFileName(name, format)).toBe(expected);
  });
});

describe("notAcceptable", () => {
  it("is a 406 not-acceptable problem", () => {
    const error = notAcceptable();
    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(406);
    expect(error.code).toBe("not-acceptable");
  });
});
