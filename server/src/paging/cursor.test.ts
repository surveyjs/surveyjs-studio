import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import {
  decodeProjectCursor,
  decodeSurveyCursor,
  encodeProjectCursor,
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
      Buffer.from(JSON.stringify({ ...surveyPayload, i: "???>>>" })).toString("base64"),
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

  it("accept a 64-character id", () => {
    const long = { ...position, id: "a".repeat(64) };
    expect(decodeSurveyCursor(encodeSurveyCursor(long, personalActive), personalActive)).toEqual(
      long,
    );
  });
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
