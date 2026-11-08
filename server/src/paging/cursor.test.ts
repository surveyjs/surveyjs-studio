import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import {
  decodeHistoryCursor,
  decodeMembersCursor,
  decodeProjectCursor,
  decodeUsersCursor,
  encodeUsersCursor,
  decodeResultsCursor,
  decodeSurveyCursor,
  encodeHistoryCursor,
  encodeMembersCursor,
  encodeProjectCursor,
  encodeResultsCursor,
  encodeSurveyCursor,
} from "./cursor.js";

const MARKETING = "55555555-0000-4000-8000-a00000000001";
const position = {
  updatedAt: "2026-04-14T15:30:00.000Z",
  id: "22222222-0000-4000-8000-a00000000001",
};
const personalActive = { scope: "personal", archived: false };

/** A cursor made by hand: base64url of the JSON text, without padding. */
const raw = (payload: unknown): string =>
  Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload), "utf8").toString(
    "base64url",
  );

const surveyPayload = {
  v: 1,
  k: "surveys",
  p: "personal",
  a: false,
  u: position.updatedAt,
  i: position.id,
};

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * The payload's cursor with one unused bit of the last character set: it decodes to the same
 * bytes, but is not the canonical encoding.
 */
function nonCanonical(payload: Record<string, unknown>): string {
  for (const pad of ["", "x", "xx"]) {
    const cursor = raw({ ...payload, i: `${String(payload.i)}${pad}` });
    if (cursor.length % 4 === 0) continue;
    const last = BASE64URL.indexOf(cursor.at(-1) ?? "");
    return cursor.slice(0, -1) + (BASE64URL[last ^ 1] ?? "");
  }
  throw new Error("unreachable");
}

function expectInvalid(decode: () => unknown): void {
  let caught: unknown;
  try {
    decode();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppError);
  expect(caught).toMatchObject({
    status: 400,
    code: "bad-request",
    title: "Bad request",
    detail: "Invalid cursor.",
  });
}

describe("survey cursors", () => {
  it("round-trip a position for its list", () => {
    const cursor = encodeSurveyCursor(position, personalActive);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSurveyCursor(cursor, personalActive)).toEqual(position);
  });

  it("round-trip a project list position, archived", () => {
    const list = { scope: MARKETING, archived: true };
    expect(decodeSurveyCursor(encodeSurveyCursor(position, list), list)).toEqual(position);
  });

  it("hold the documented JSON payload", () => {
    const cursor = encodeSurveyCursor(position, personalActive);
    expect(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))).toEqual(surveyPayload);
    expect(cursor).toBe(raw(surveyPayload));
  });

  it("accept a hand-made cursor in the documented format", () => {
    expect(decodeSurveyCursor(raw(surveyPayload), personalActive)).toEqual(position);
  });

  it("reject a cursor of another scope or archived state", () => {
    const cursor = encodeSurveyCursor(position, { scope: MARKETING, archived: false });
    expectInvalid(() => decodeSurveyCursor(cursor, personalActive));
    expectInvalid(() => decodeSurveyCursor(cursor, { scope: MARKETING, archived: true }));
  });

  it.each([
    ["an empty value", ""],
    ["text that is not base64url", "abc!"],
    ["padding", `${raw({ ...surveyPayload, i: "x" })}=`],
    // "???>>>" puts "/" and "+" in the base64 text, where base64url has "_" and "-".
    [
      "standard base64 characters",
      Buffer.from(JSON.stringify({ ...surveyPayload, i: "???>>>" }))
        .toString("base64")
        .replace(/=+$/, ""),
    ],
    ["non-canonical trailing bits", nonCanonical(surveyPayload)],
    ["text that is not JSON", raw("not json")],
    ["a JSON value that is not an object", raw("[1]")],
    ["JSON with extra spaces", raw(JSON.stringify(surveyPayload, null, 1))],
    ["members in another order", raw(Object.fromEntries(Object.entries(surveyPayload).reverse()))],
    ["an extra member", raw({ ...surveyPayload, x: 1 })],
    ["the wrong version", raw({ ...surveyPayload, v: 2 })],
    ["the wrong kind", raw({ ...surveyPayload, k: "projects" })],
    [
      "a missing member",
      raw({ v: 1, k: "surveys", p: "personal", a: false, u: position.updatedAt }),
    ],
    ["archived not a boolean", raw({ ...surveyPayload, a: "false" })],
    ["a timestamp that is not ISO", raw({ ...surveyPayload, u: "April 14, 2026" })],
    ["a timestamp that is not a date", raw({ ...surveyPayload, u: "2026-13-45T15:30:00.000Z" })],
    ["a timestamp before 1753", raw({ ...surveyPayload, u: "1752-12-31T23:59:59.999Z" })],
    ["a timestamp in year 1000", raw({ ...surveyPayload, u: "1000-01-01T00:00:00.000Z" })],
    [
      "a timestamp with an expanded year",
      raw({ ...surveyPayload, u: "+010000-01-01T00:00:00.000Z" }),
    ],
    ["a timestamp without milliseconds", raw({ ...surveyPayload, u: "2026-04-14T15:30:00Z" })],
    ["an id that is not a string", raw({ ...surveyPayload, i: 5 })],
    ["an empty id", raw({ ...surveyPayload, i: "" })],
    ["an id longer than 64 characters", raw({ ...surveyPayload, i: "a".repeat(65) })],
    ["an upper-case id", raw({ ...surveyPayload, i: position.id.toUpperCase() })],
  ])("reject %s", (_name, cursor) => {
    expectInvalid(() => decodeSurveyCursor(cursor, personalActive));
  });

  it("reject a value over 1024 characters", () => {
    const list = { scope: "p".repeat(1000), archived: false };
    const cursor = encodeSurveyCursor(position, list);
    expect(cursor.length).toBeGreaterThan(1024);
    expectInvalid(() => decodeSurveyCursor(cursor, list));
  });

  it.each(["1753-01-01T00:00:00.000Z", "9999-12-31T23:59:59.999Z"])(
    "accept the timestamp %s, a limit of the SQL datetime range",
    (updatedAt) => {
      const edge = { ...position, updatedAt };
      expect(decodeSurveyCursor(encodeSurveyCursor(edge, personalActive), personalActive)).toEqual(
        edge,
      );
    },
  );

  // Survey ids are GUIDs in every provider; the SQL stores' uuid column refuses anything else.
  it.each(["zzz", "a".repeat(64), "22222222-0000-4000-8000-a0000000000"])(
    "reject the id %s, which is not a GUID",
    (id) => {
      expectInvalid(() =>
        decodeSurveyCursor(encodeSurveyCursor({ ...position, id }, personalActive), personalActive),
      );
    },
  );
});

describe("project cursors", () => {
  const projectPosition = { name: "marketing", id: MARKETING };
  const projectPayload = { v: 1, k: "projects", n: "marketing", i: MARKETING };

  it("round-trip a position, with the name lower-cased", () => {
    const cursor = encodeProjectCursor({ name: "Marketing", id: MARKETING });
    expect(cursor).toBe(raw(projectPayload));
    expect(decodeProjectCursor(cursor)).toEqual(projectPosition);
  });

  it("keep names with any characters", () => {
    const named = { name: "été — 2026 «q3»", id: MARKETING };
    expect(decodeProjectCursor(encodeProjectCursor(named))).toEqual(named);
  });

  it.each([
    ["text that is not base64url", "***"],
    ["a survey cursor", encodeSurveyCursor(position, personalActive)],
    ["the wrong version", raw({ ...projectPayload, v: 0 })],
    ["a name that is not a string", raw({ ...projectPayload, n: null })],
    ["a name that is not lower-case", raw({ ...projectPayload, n: "Marketing" })],
    ["an empty id", raw({ ...projectPayload, i: "" })],
    ["an id longer than 64 characters", raw({ ...projectPayload, i: "b".repeat(65) })],
    ["padding", `${raw({ ...projectPayload, n: "ab" })}=`],
    ["a value over 1024 characters", raw({ ...projectPayload, n: "n".repeat(1024) })],
  ])("reject %s", (_name, cursor) => {
    expectInvalid(() => decodeProjectCursor(cursor));
  });
});

describe("user list cursors", () => {
  const userPosition = { email: "nina@example.com", id: MARKETING };
  const usersPayload = { v: 1, k: "users", e: "nina@example.com", i: MARKETING };

  it("round-trip a position, with the email lower-cased", () => {
    const cursor = encodeUsersCursor({ email: "Nina@Example.com", id: MARKETING });
    expect(cursor).toBe(raw(usersPayload));
    expect(decodeUsersCursor(cursor)).toEqual(userPosition);
  });

  it.each([
    ["a project cursor", encodeProjectCursor({ name: "marketing", id: MARKETING })],
    ["an email that is not a string", raw({ ...usersPayload, e: 1 })],
    ["an email that is not lower-case", raw({ ...usersPayload, e: "Nina@example.com" })],
  ])("reject %s", (_name, cursor) => {
    expectInvalid(() => decodeUsersCursor(cursor));
  });
});

describe("history cursors", () => {
  const entry = { at: "2026-04-14T15:30:00.000Z", id: "88888888-0000-4000-8000-a00000000001" };
  const historyPayload = { v: 1, k: "history", u: entry.at, i: entry.id };

  it("round-trip a position", () => {
    const cursor = encodeHistoryCursor(entry);
    expect(cursor).toBe(raw(historyPayload));
    expect(decodeHistoryCursor(cursor)).toEqual(entry);
  });

  it.each([
    ["text that is not base64url", "***"],
    ["a survey cursor", encodeSurveyCursor(position, personalActive)],
    ["the wrong version", raw({ ...historyPayload, v: 0 })],
    ["a loose timestamp", raw({ ...historyPayload, u: "2026-04-14T15:30:00Z" })],
    ["an empty id", raw({ ...historyPayload, i: "" })],
    ["an upper-case id", raw({ ...historyPayload, i: entry.id.toUpperCase() })],
    ["an id that is not a GUID", raw({ ...historyPayload, i: "zzz" })],
    ["padding", `${raw(historyPayload)}=`],
  ])("reject %s", (_name, cursor) => {
    expectInvalid(() => decodeHistoryCursor(cursor));
  });
});

describe("results cursors", () => {
  const survey = "22222222-0000-4000-8000-A00000000008";
  const place = {
    submittedAt: "2026-05-01T12:10:00.000Z",
    id: "66666666-0000-4000-8000-c000000001f4",
  };
  const resultsPayload = {
    v: 1,
    k: "results",
    s: "22222222-0000-4000-8000-a00000000008",
    u: place.submittedAt,
    i: place.id,
  };

  it("encodes the canonical payload of the lower-case survey id", () => {
    const cursor = encodeResultsCursor(place, survey);
    expect(cursor).toBe(
      "eyJ2IjoxLCJrIjoicmVzdWx0cyIsInMiOiIyMjIyMjIyMi0wMDAwLTQwMDAtODAwMC1hMDAwMDAwMDAwMDgiLCJ1IjoiMjAyNi0wNS0wMVQxMjoxMDowMC4wMDBaIiwiaSI6IjY2NjY2NjY2LTAwMDAtNDAwMC04MDAwLWMwMDAwMDAwMDFmNCJ9",
    );
    expect(cursor).toBe(raw(resultsPayload));
  });

  it("decodes back for the survey, in any case", () => {
    const cursor = encodeResultsCursor(place, survey);
    expect(decodeResultsCursor(cursor, survey)).toEqual(place);
    expect(decodeResultsCursor(cursor, survey.toLowerCase())).toEqual(place);
  });

  it.each([
    ["another survey's cursor", encodeResultsCursor(place, "22222222-0000-4000-8000-a00000000001")],
    ["a history cursor", raw({ ...resultsPayload, k: "history" })],
    ["an upper-case id", raw({ ...resultsPayload, i: place.id.toUpperCase() })],
    ["a loose timestamp", raw({ ...resultsPayload, u: "2026-05-01T12:10:00Z" })],
    ["an extra member", raw({ ...resultsPayload, x: 1 })],
    ["a missing survey", raw({ v: 1, k: "results", u: place.submittedAt, i: place.id })],
    ["an id of 65 characters", raw({ ...resultsPayload, i: "a".repeat(65) })],
    ["an id that is not a GUID", raw({ ...resultsPayload, i: "zzz" })],
    ["padding", `${raw(resultsPayload)}=`],
  ])("rejects %s", (_name, cursor) => {
    expectInvalid(() => decodeResultsCursor(cursor, survey));
  });
});

describe("members cursors", () => {
  const ENGINEERING = "55555555-0000-4000-8000-a00000000002";
  const member = { name: "mia member", id: "11111111-0000-4000-8000-a00000000003" };
  const membersPayload = { v: 1, k: "members", p: MARKETING, n: member.name, i: member.id };

  it("round-trip a position of the project, with the name lower-cased", () => {
    const cursor = encodeMembersCursor({ ...member, name: "Mia Member" }, MARKETING);
    expect(cursor).toBe(raw(membersPayload));
    expect(decodeMembersCursor(cursor, MARKETING)).toEqual(member);
  });

  it("belong to the project in any case of its id", () => {
    const cursor = encodeMembersCursor(member, MARKETING.toUpperCase());
    expect(cursor).toBe(raw(membersPayload));
    expect(decodeMembersCursor(cursor, MARKETING.toUpperCase())).toEqual(member);
  });

  it("keep names with any characters", () => {
    const named = { name: "été — 2026 «q3»", id: member.id };
    expect(decodeMembersCursor(encodeMembersCursor(named, MARKETING), MARKETING)).toEqual(named);
  });

  it.each([
    ["another project's cursor", encodeMembersCursor(member, ENGINEERING)],
    ["a project cursor", encodeProjectCursor({ name: "marketing", id: MARKETING })],
    ["a survey cursor", encodeSurveyCursor(position, personalActive)],
    ["text that is not base64url", "***"],
    ["the wrong version", raw({ ...membersPayload, v: 2 })],
    ["the wrong kind", raw({ ...membersPayload, k: "projects" })],
    ["a missing project", raw({ v: 1, k: "members", n: member.name, i: member.id })],
    ["a name that is not a string", raw({ ...membersPayload, n: 5 })],
    ["a name that is not lower-case", raw({ ...membersPayload, n: "Mia Member" })],
    ["an empty id", raw({ ...membersPayload, i: "" })],
    ["an upper-case id", raw({ ...membersPayload, i: member.id.toUpperCase() })],
    ["an id longer than 64 characters", raw({ ...membersPayload, i: "a".repeat(65) })],
    ["an extra member", raw({ ...membersPayload, x: 1 })],
    ["members in another order", raw(Object.fromEntries(Object.entries(membersPayload).reverse()))],
    ["padding", `${raw({ ...membersPayload, n: "ab" })}=`],
    ["non-canonical trailing bits", nonCanonical(membersPayload)],
    ["a value over 1024 characters", raw({ ...membersPayload, n: "n".repeat(1024) })],
  ])("reject %s", (_name, cursor) => {
    expectInvalid(() => decodeMembersCursor(cursor, MARKETING));
  });
});
