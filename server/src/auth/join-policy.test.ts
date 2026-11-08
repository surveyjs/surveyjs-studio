import { describe, expect, it } from "vitest";
import { decideJoin } from "./join-policy.js";

const closed = { signUpDomains: [], openSignUp: false };
const domain = { signUpDomains: ["example.com"], openSignUp: false };
const open = { signUpDomains: [], openSignUp: true };

const person = (
  email: string | undefined,
  over: { emailVerified?: boolean; invited?: boolean } = {},
) => ({
  email,
  emailVerified: over.emailVerified ?? true,
  invited: over.invited ?? false,
});

describe("decideJoin", () => {
  it.each([
    ["a@evil-example.com"],
    ["a@example.com.evil.net"],
    ["a@sub.example.com"],
    ["example.com@evil.net"],
  ])("refuses %s with SIGN_UP_DOMAINS=example.com", (email) => {
    expect(decideJoin(person(email), domain)).toEqual({ join: false, reason: "not-invited" });
  });

  it("matches the domain after the last @, in any letter case", () => {
    expect(decideJoin(person("A@EXAMPLE.COM"), domain)).toEqual({ join: true, because: "domain" });
    expect(decideJoin(person('"a@evil.net"@example.com'), domain)).toEqual({
      join: true,
      because: "domain",
    });
  });

  it("refuses without an email, or with an unverified one, even when invited", () => {
    expect(decideJoin(person(undefined, { invited: true }), open)).toEqual({
      join: false,
      reason: "email-unverified",
    });
    expect(decideJoin(person("", { invited: true }), open)).toEqual({
      join: false,
      reason: "email-unverified",
    });
    expect(
      decideJoin(person("a@example.com", { emailVerified: false, invited: true }), open),
    ).toEqual({
      join: false,
      reason: "email-unverified",
    });
  });

  it("lets an invited email join first, then a listed domain, then open sign-up", () => {
    const all = { signUpDomains: ["example.com"], openSignUp: true };
    expect(decideJoin(person("a@example.com", { invited: true }), all)).toEqual({
      join: true,
      because: "invited",
    });
    expect(decideJoin(person("a@example.com"), all)).toEqual({ join: true, because: "domain" });
    expect(decideJoin(person("a@other.net"), all)).toEqual({ join: true, because: "open" });
    expect(decideJoin(person("a@other.net", { invited: true }), closed)).toEqual({
      join: true,
      because: "invited",
    });
  });

  it("refuses a stranger when sign-up is closed", () => {
    expect(decideJoin(person("a@other.net"), closed)).toEqual({
      join: false,
      reason: "not-invited",
    });
    expect(decideJoin(person("a@other.net"), domain)).toEqual({
      join: false,
      reason: "not-invited",
    });
  });
});
