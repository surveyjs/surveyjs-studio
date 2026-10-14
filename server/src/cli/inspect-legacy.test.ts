import { describe, expect, it } from "vitest";
import { formatSurveyTable, parseArgs } from "./inspect-legacy.js";
import type { SurveyRecord } from "../domain/types.js";

function survey(over: Partial<SurveyRecord>): SurveyRecord {
  return {
    id: "s1",
    name: "One",
    owner: { kind: "personal", userId: "u" },
    creatorId: null,
    postId: "p",
    resultId: "r",
    published: true,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-02T00:00:00.000Z",
    settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
    ...over,
  };
}

describe("parseArgs", () => {
  it("accepts --user and --env-file", () => {
    expect(parseArgs(["--user", "a@b.c", "--env-file", "x.env"])).toEqual({
      kind: "run",
      user: "a@b.c",
      envFile: "x.env",
    });
  });
  it("accepts --user alone", () => {
    expect(parseArgs(["--user", "a@b.c"])).toEqual({ kind: "run", user: "a@b.c", envFile: null });
  });
  it("rejects a missing --user", () => {
    expect(parseArgs([])).toMatchObject({ kind: "usage-error" });
  });
  it("rejects a --user without a value", () => {
    expect(parseArgs(["--user"])).toMatchObject({ kind: "usage-error" });
  });
  it("rejects an unknown flag", () => {
    expect(parseArgs(["--user", "a", "--write"])).toMatchObject({
      kind: "usage-error",
      message: expect.stringContaining("--write"),
    });
  });
  it("returns help for --help", () => {
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
  });
});

describe("formatSurveyTable", () => {
  it("prints (no surveys) for an empty scope", () => {
    expect(formatSurveyTable([])).toBe("(no surveys)");
  });
  it("prints a fixed-width table", () => {
    const text = formatSurveyTable([
      survey({}),
      survey({ id: "s22", name: "Second", published: false, archived: true }),
    ]);
    expect(text).toBe(
      [
        "Id   Name    Published  Archived  Created                   Updated",
        "s1   One     yes        no        2026-01-01T00:00:00.000Z  2026-02-02T00:00:00.000Z",
        "s22  Second  no         yes       2026-01-01T00:00:00.000Z  2026-02-02T00:00:00.000Z",
      ].join("\n"),
    );
  });
});
