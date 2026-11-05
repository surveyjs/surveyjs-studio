import { describe, expect, it } from "vitest";
import {
  decodeHistoryCursor,
  decodeMembersCursor,
  decodeProjectCursor,
  decodeResultsCursor,
  decodeSurveyCursor,
  encodeHistoryCursor,
  encodeMembersCursor,
  encodeProjectCursor,
  encodeResultsCursor,
  encodeSurveyCursor,
} from "./paging";
import { ProblemError } from "./problems";

const ID = "22222222-0000-4000-8000-a00000000001";
const AT = "2026-04-14T15:30:00.000Z";
const LIST = { scope: "personal", archived: false };

const base64url = (text: string) =>
  btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

function invalid(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ProblemError);
    expect((error as ProblemError).init).toMatchObject({
      code: "bad-request",
      status: 400,
      detail: "Invalid cursor.",
    });
    return;
  }
  throw new Error("the cursor was accepted");
}

describe("cursors", () => {
  it("encode as the server does: base64url JSON with v and k, no padding", () => {
    const cursor = encodeSurveyCursor({ updatedAt: AT, id: ID }, LIST);
    expect(cursor).toBe(
      base64url(JSON.stringify({ v: 1, k: "surveys", p: "personal", a: false, u: AT, i: ID })),
    );
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("round-trip for every kind", () => {
    expect(decodeSurveyCursor(encodeSurveyCursor({ updatedAt: AT, id: ID }, LIST), LIST)).toEqual({
      updatedAt: AT,
      id: ID,
    });
    expect(decodeHistoryCursor(encodeHistoryCursor({ at: AT, id: ID }))).toEqual({
      at: AT,
      id: ID,
    });
    expect(decodeProjectCursor(encodeProjectCursor({ name: "Ünï", id: "p1" }))).toEqual({
      name: "ünï",
      id: "p1",
    });
    expect(decodeMembersCursor(encodeMembersCursor({ name: "Mia", id: ID }, "P1"), "p1")).toEqual({
      name: "mia",
      id: ID,
    });
    expect(decodeResultsCursor(encodeResultsCursor({ submittedAt: AT, id: ID }, ID), ID)).toEqual({
      submittedAt: AT,
      id: ID,
    });
  });

  it("reject a cursor of another list, kind, project or survey", () => {
    const cursor = encodeSurveyCursor({ updatedAt: AT, id: ID }, LIST);
    invalid(() => decodeSurveyCursor(cursor, { scope: "personal", archived: true }));
    invalid(() => decodeSurveyCursor(cursor, { scope: "other", archived: false }));
    invalid(() => decodeHistoryCursor(cursor));
    invalid(() => decodeProjectCursor(cursor));
    invalid(() => decodeMembersCursor(encodeMembersCursor({ name: "a", id: "i" }, "p1"), "p2"));
    invalid(() => decodeResultsCursor(encodeResultsCursor({ submittedAt: AT, id: ID }, ID), "x"));
  });

  it("reject anything that is not the canonical encoding", () => {
    const payload = { v: 1, k: "history", u: AT, i: ID };
    const good = base64url(JSON.stringify(payload));
    expect(decodeHistoryCursor(good).id).toBe(ID);
    invalid(() => decodeHistoryCursor(`${good}=`));
    invalid(() => decodeHistoryCursor(base64url(JSON.stringify({ ...payload, extra: 1 }))));
    invalid(() =>
      decodeHistoryCursor(base64url(JSON.stringify({ ...payload, i: ID.toUpperCase() }))),
    );
    invalid(() => decodeHistoryCursor(base64url(JSON.stringify({ ...payload, u: "2026-04-14" }))));
    invalid(() => decodeHistoryCursor(base64url(JSON.stringify({ ...payload, v: 2 }))));
    invalid(() => decodeHistoryCursor(base64url(JSON.stringify([1]))));
    invalid(() => decodeHistoryCursor(base64url("not json")));
    invalid(() => decodeHistoryCursor("a"));
    invalid(() => decodeHistoryCursor("***"));
    invalid(() => decodeHistoryCursor("a".repeat(2000)));
  });
});
