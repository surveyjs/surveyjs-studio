import { describe, expect, it } from "vitest";
import { seal } from "./seal.js";
import { encodeSession } from "./session.js";
import { createTransaction, decodeTransaction, encodeTransaction } from "./transaction.js";

const SECRET = "a-test-secret-that-is-at-least-32-chars";
const NOW = 1_800_000_000_000;
const clock = (ms: number) => () => ms;

describe("sign-in transaction", () => {
  it("creates fresh random state, nonce and PKCE verifier, valid for ten minutes", () => {
    const a = createTransaction("/a", undefined, clock(NOW));
    const b = createTransaction("/a", undefined, clock(NOW));
    expect(a.returnTo).toBe("/a");
    expect(a.exp).toBe(NOW / 1000 + 600);
    for (const value of [a.state, a.nonce, a.codeVerifier]) {
      expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(new Set([a.state, a.nonce, a.codeVerifier, b.state, b.nonce, b.codeVerifier]).size).toBe(
      6,
    );
  });

  it("round-trips through the sealed cookie value", () => {
    const tx = createTransaction("/surveys?x=1", undefined, clock(NOW));
    const sealed = encodeTransaction(SECRET, tx);
    expect(decodeTransaction(SECRET, sealed, clock(NOW))).toEqual(tx);
  });

  it("reads as none when missing, expired, tampered with or sealed for another purpose", () => {
    const tx = createTransaction("/", undefined, clock(NOW));
    const sealed = encodeTransaction(SECRET, tx);
    expect(decodeTransaction(SECRET, undefined, clock(NOW))).toBeNull();
    expect(decodeTransaction(SECRET, sealed, clock(NOW + 600_000))).toBeNull();
    expect(decodeTransaction(SECRET, `${sealed}x`, clock(NOW))).toBeNull();
    expect(decodeTransaction(`${SECRET}-other`, sealed, clock(NOW))).toBeNull();
    const session = encodeSession(SECRET, {
      sub: "u",
      name: "n",
      email: "e@example.com",
      avatarUrl: null,
      csrf: "c",
      exp: NOW / 1000 + 600,
    });
    expect(decodeTransaction(SECRET, session, clock(NOW))).toBeNull();
  });

  it("reads a sealed value without the expected fields as none", () => {
    const sealed = seal(
      "msid-auth-v1",
      SECRET,
      JSON.stringify({ state: "s", exp: NOW / 1000 + 60 }),
    );
    expect(decodeTransaction(SECRET, sealed, clock(NOW))).toBeNull();
    expect(
      decodeTransaction(SECRET, seal("msid-auth-v1", SECRET, "not json"), clock(NOW)),
    ).toBeNull();
  });
});

describe("sign-in transaction provider", () => {
  it("round-trips the provider, and reads a cookie without one as no provider", () => {
    const github = createTransaction("/", "github", clock(NOW));
    expect(github.provider).toBe("github");
    expect(decodeTransaction(SECRET, encodeTransaction(SECRET, github), clock(NOW))).toEqual(
      github,
    );
    const plain = createTransaction("/", undefined, clock(NOW));
    expect("provider" in plain).toBe(false);
    const decoded = decodeTransaction(SECRET, encodeTransaction(SECRET, plain), clock(NOW));
    expect(decoded).not.toBeNull();
    expect(decoded && "provider" in decoded).toBe(false);
  });

  it("reads an unknown provider as none", () => {
    const tx = { ...createTransaction("/", undefined, clock(NOW)), provider: "x" };
    const sealed = seal("msid-auth-v1", SECRET, JSON.stringify(tx));
    expect(decodeTransaction(SECRET, sealed, clock(NOW))).toBeNull();
  });
});
