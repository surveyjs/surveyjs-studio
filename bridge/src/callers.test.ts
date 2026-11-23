import { describe, expect, it } from "vitest";
import { hashCredential } from "../../server/src/credentials/format.js";
import { keyHashPrefix, summarizeCallers, toCsv } from "./callers.js";

describe("keyHashPrefix", () => {
  it("is the first 16 hex digits of Studio's hash of a legacy key, whatever its letter case", () => {
    const expected = hashCredential("ABC-key", "legacy-key").slice(0, 16);
    expect(keyHashPrefix("ABC-key")).toBe(expected);
    expect(keyHashPrefix("abc-KEY")).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{16}$/);
  });

  it("hashes an sjs_ API token exactly as sent", () => {
    const token = "sjs_AbCdEf";
    expect(keyHashPrefix(token)).toBe(hashCredential(token, "api-token").slice(0, 16));
    expect(keyHashPrefix(token)).not.toBe(keyHashPrefix(token.toLowerCase()));
  });
});

/** A request log line as pino writes it. */
function line(time: string, fields: Record<string, unknown>): string {
  return JSON.stringify({
    level: 30,
    time: Date.parse(time),
    reqId: "req-1",
    msg: "request",
    ...fields,
  });
}

describe("summarizeCallers", () => {
  it("counts each day, key and action with its first and last time, skipping other lines", () => {
    const rows = summarizeCallers([
      line("2026-11-20T23:59:00.000Z", { action: "getActive", key: "bbbb", status: "200" }),
      line("2026-11-20T08:00:00.000Z", { action: "getActive", key: "bbbb", status: "200" }),
      line("2026-11-20T09:30:00.000Z", { action: "getSurveyResults", key: "bbbb", status: "200" }),
      "not json at all",
      JSON.stringify({ level: 30, time: Date.parse("2026-11-20T10:00:00Z"), msg: "starting" }),
      line("2026-11-21T00:00:01.000Z", { action: "getActive", key: "bbbb", status: "200" }),
      line("2026-11-21T12:00:00.000Z", { action: "getActive", key: "aaaa", status: "401" }),
      line("2026-11-21T13:00:00.000Z", { action: "getSurvey", status: "200", cache: "hit" }),
      "",
    ]);
    expect(rows).toEqual([
      {
        day: "2026-11-20",
        key: "bbbb",
        action: "getActive",
        count: 2,
        first: "2026-11-20T08:00:00.000Z",
        last: "2026-11-20T23:59:00.000Z",
      },
      {
        day: "2026-11-20",
        key: "bbbb",
        action: "getSurveyResults",
        count: 1,
        first: "2026-11-20T09:30:00.000Z",
        last: "2026-11-20T09:30:00.000Z",
      },
      {
        day: "2026-11-21",
        key: "",
        action: "getSurvey",
        count: 1,
        first: "2026-11-21T13:00:00.000Z",
        last: "2026-11-21T13:00:00.000Z",
      },
      {
        day: "2026-11-21",
        key: "aaaa",
        action: "getActive",
        count: 1,
        first: "2026-11-21T12:00:00.000Z",
        last: "2026-11-21T12:00:00.000Z",
      },
      {
        day: "2026-11-21",
        key: "bbbb",
        action: "getActive",
        count: 1,
        first: "2026-11-21T00:00:01.000Z",
        last: "2026-11-21T00:00:01.000Z",
      },
    ]);
  });
});

describe("toCsv", () => {
  it("writes a header and one line per row, quoting a value that needs it", () => {
    expect(
      toCsv([
        {
          day: "2026-11-21",
          key: "aaaa",
          action: "getActive",
          count: 3,
          first: "2026-11-21T12:00:00.000Z",
          last: "2026-11-21T13:00:00.000Z",
        },
        {
          day: "2026-11-21",
          key: "",
          action: 'odd,"name"',
          count: 1,
          first: "2026-11-21T12:00:00.000Z",
          last: "2026-11-21T12:00:00.000Z",
        },
      ]),
    ).toBe(
      "day,key,action,count,first,last\n" +
        "2026-11-21,aaaa,getActive,3,2026-11-21T12:00:00.000Z,2026-11-21T13:00:00.000Z\n" +
        '2026-11-21,,"odd,""name""",1,2026-11-21T12:00:00.000Z,2026-11-21T12:00:00.000Z\n',
    );
  });
});
