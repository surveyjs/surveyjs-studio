import { describe, expect, it } from "vitest";
import { seal, unseal } from "./seal.js";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("seal", () => {
  it("round-trips a value", () => {
    const sealed = seal("msid-session-v1", SECRET, '{"a":"ü"}');
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+$/);
    expect(unseal("msid-session-v1", SECRET, sealed)).toBe('{"a":"ü"}');
  });

  it("seals the same value differently every time", () => {
    expect(seal("msid-auth-v1", SECRET, "x")).not.toBe(seal("msid-auth-v1", SECRET, "x"));
  });

  it("does not contain the plaintext", () => {
    expect(seal("msid-session-v1", SECRET, "plain-visible-text")).not.toContain("plain");
  });

  it("rejects a tampered byte anywhere in the value", () => {
    const sealed = seal("msid-session-v1", SECRET, "hello");
    const [version, iv, body] = sealed.split(".") as [string, string, string];
    const flip = (text: string, at: number) =>
      text.slice(0, at) + (text[at] === "A" ? "B" : "A") + text.slice(at + 1);
    expect(unseal("msid-session-v1", SECRET, [version, flip(iv, 2), body].join("."))).toBeNull();
    expect(unseal("msid-session-v1", SECRET, [version, iv, flip(body, 0)].join("."))).toBeNull();
    const last = body.length - 3;
    expect(unseal("msid-session-v1", SECRET, [version, iv, flip(body, last)].join("."))).toBeNull();
  });

  it("rejects a truncated value", () => {
    const sealed = seal("msid-session-v1", SECRET, "hello");
    for (const cut of [1, 5, 20]) {
      expect(unseal("msid-session-v1", SECRET, sealed.slice(0, -cut))).toBeNull();
    }
    expect(unseal("msid-session-v1", SECRET, "")).toBeNull();
    expect(unseal("msid-session-v1", SECRET, "v1")).toBeNull();
    expect(unseal("msid-session-v1", SECRET, "v1..")).toBeNull();
  });

  it("rejects non-canonical base64url that Node would still decode", () => {
    const [version, iv, body] = seal("msid-session-v1", SECRET, "hello").split(".") as [
      string,
      string,
      string,
    ];
    // A body whose length is a multiple of 4 takes a stray trailing group.
    const aligned = seal("msid-session-v1", SECRET, "abcdefghijk").split(".") as [
      string,
      string,
      string,
    ];
    const cases = [
      [version, iv, `${body}=`],
      [version, `${iv}=`, body],
      [version, iv, `${body}!`],
      [version, iv, `${body.slice(0, 5)} ${body.slice(5)}`],
      [
        version,
        iv,
        `${body.slice(0, 5)}
${body.slice(5)}`,
      ],
    ];
    for (const parts of cases) {
      expect(unseal("msid-session-v1", SECRET, parts.join("."))).toBeNull();
    }
    expect(unseal("msid-session-v1", SECRET, aligned.join("."))).toBe("abcdefghijk");
    const [v, i, b] = aligned;
    const pad = (4 - (b.length % 4)) % 4;
    expect(pad).toBe(0);
    expect(unseal("msid-session-v1", SECRET, [v, i, `${b}A`].join("."))).toBeNull();
  });

  it("rejects a value sealed for another purpose", () => {
    const sealed = seal("msid-auth-v1", SECRET, "hello");
    expect(unseal("msid-session-v1", SECRET, sealed)).toBeNull();
  });

  it("rejects a value sealed with another secret", () => {
    const sealed = seal("msid-session-v1", SECRET, "hello");
    expect(unseal("msid-session-v1", `${SECRET}x`, sealed)).toBeNull();
  });

  it("rejects an unknown version", () => {
    const sealed = seal("msid-session-v1", SECRET, "hello");
    expect(unseal("msid-session-v1", SECRET, sealed.replace(/^v1/, "v2"))).toBeNull();
  });

  it("rejects text that is not a sealed value", () => {
    for (const junk of ["not sealed", "v1.a.b", "v1.!!.!!", "v1.a.b.c"]) {
      expect(unseal("msid-session-v1", SECRET, junk)).toBeNull();
    }
  });
});
