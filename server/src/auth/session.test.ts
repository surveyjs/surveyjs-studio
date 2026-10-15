import { describe, expect, it } from "vitest";
import { seal } from "./seal.js";
import { createSession, decodeSession, encodeSession } from "./session.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const NOW_MS = 1_700_000_000_000;
const NOW_S = 1_700_000_000;

const user = { sub: "u-1", name: "Ann", email: "ann@example.com", avatarUrl: null };

describe("session", () => {
  it("round-trips a session", () => {
    const session = createSession(user, "csrf-1", 60, () => NOW_MS);
    expect(session).toEqual({ ...user, csrf: "csrf-1", exp: NOW_S + 60 });
    expect(decodeSession(SECRET, encodeSession(SECRET, session), () => NOW_MS)).toEqual(session);
  });

  it("keeps an avatar URL", () => {
    const withAvatar = { ...user, avatarUrl: "https://a.example/p.png" };
    const session = createSession(withAvatar, "c", 60, () => NOW_MS);
    expect(decodeSession(SECRET, encodeSession(SECRET, session), () => NOW_MS)).toEqual(session);
  });

  it("is valid until the expiry second and gone from that second on", () => {
    const value = encodeSession(
      SECRET,
      createSession(user, "c", 60, () => NOW_MS),
    );
    expect(decodeSession(SECRET, value, () => (NOW_S + 59) * 1000 + 999)).not.toBeNull();
    expect(decodeSession(SECRET, value, () => (NOW_S + 60) * 1000)).toBeNull();
    expect(decodeSession(SECRET, value, () => (NOW_S + 3600) * 1000)).toBeNull();
  });

  it("decodes tampered, foreign and missing values to no session", () => {
    const value = encodeSession(
      SECRET,
      createSession(user, "c", 60, () => NOW_MS),
    );
    const [version, iv, body] = value.split(".") as [string, string, string];
    const flipped = (body[0] === "A" ? "B" : "A") + body.slice(1);
    expect(decodeSession(SECRET, [version, iv, flipped].join("."), () => NOW_MS)).toBeNull();
    expect(decodeSession(`${SECRET}x`, value, () => NOW_MS)).toBeNull();
    expect(decodeSession(SECRET, undefined, () => NOW_MS)).toBeNull();
    expect(decodeSession(SECRET, "", () => NOW_MS)).toBeNull();
  });

  it("does not accept a sealed value of another purpose", () => {
    const payload = JSON.stringify({ ...user, csrf: "c", exp: NOW_S + 60 });
    expect(decodeSession(SECRET, seal("msid-auth-v1", SECRET, payload), () => NOW_MS)).toBeNull();
  });

  it.each([
    ["not json", "nope"],
    ["an array", "[]"],
    [
      "a missing field",
      JSON.stringify({ sub: "u", name: "n", email: "e", csrf: "c", exp: NOW_S + 60 }),
    ],
    ["a non-numeric exp", JSON.stringify({ ...user, csrf: "c", exp: "soon" })],
    ["an empty sub", JSON.stringify({ ...user, sub: "", csrf: "c", exp: NOW_S + 60 })],
  ])("treats a validly sealed payload with %s as no session", (_name, json) => {
    const value = seal("msid-session-v1", SECRET, json);
    expect(decodeSession(SECRET, value, () => NOW_MS)).toBeNull();
  });
});
