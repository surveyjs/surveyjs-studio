import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./hash.js";
import { createLockout } from "./lockout.js";
import { passwordProblem } from "./policy.js";

describe("hashPassword and verifyPassword", () => {
  it("verifies the password it hashed, and no other", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same password here")).not.toBe(
      await hashPassword("same password here"),
    );
  });

  it("verifies a hash made with other parameters, as stored in it", async () => {
    const stronger = await hashPassword("other parameters", { memory: 32768, passes: 3 });
    expect(stronger).toContain("$m=32768,t=3,p=1$");
    expect(await verifyPassword("other parameters", stronger)).toBe(true);
  });

  it("answers false for a stored value that is not an argon2id hash", async () => {
    for (const stored of [
      "",
      "plain",
      "$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
      "$argon2id$v=19$m=x$a$b",
    ]) {
      expect(await verifyPassword("anything", stored)).toBe(false);
    }
  });
});

describe("passwordProblem", () => {
  it("accepts 12 characters or more that are not a common password", () => {
    expect(passwordProblem("a long enough one")).toBeNull();
    expect(passwordProblem("twelve chars")).toBeNull();
  });

  it("refuses fewer than 12 characters, counting an emoji as one", () => {
    expect(passwordProblem("short pass1")).toBe("Use at least 12 characters.");
    expect(passwordProblem("🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑")).toBe("Use at least 12 characters.");
    expect(passwordProblem("🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑")).toBeNull();
  });

  it("refuses a common password, in any letter case", () => {
    expect(passwordProblem("password1234")).toBe(
      "This password is too common. Choose another one.",
    );
    expect(passwordProblem("Password1234")).toBe(
      "This password is too common. Choose another one.",
    );
    expect(passwordProblem("123456789012")).toBe(
      "This password is too common. Choose another one.",
    );
  });
});

describe("createLockout", () => {
  const MINUTE = 60_000;

  it("locks an email after 5 failures, for 1 minute, doubling with each failure after", () => {
    let now = 0;
    const lockout = createLockout({ now: () => now });
    for (let i = 0; i < 4; i++) lockout.failed("A@example.com");
    expect(lockout.retryAfterSeconds("a@example.com")).toBe(0);
    lockout.failed("a@example.com");
    expect(lockout.retryAfterSeconds("a@example.com")).toBe(60);
    now += MINUTE;
    expect(lockout.retryAfterSeconds("a@example.com")).toBe(0);
    lockout.failed("a@example.com");
    expect(lockout.retryAfterSeconds("a@example.com")).toBe(120);
    now += 2 * MINUTE;
    lockout.failed("a@example.com");
    expect(lockout.retryAfterSeconds("a@example.com")).toBe(240);
  });

  it("waits an hour at most", () => {
    let now = 0;
    const lockout = createLockout({ now: () => now });
    for (let i = 0; i < 30; i++) {
      lockout.failed("b@example.com");
      now += 1000;
    }
    expect(lockout.retryAfterSeconds("b@example.com")).toBeLessThanOrEqual(3600);
  });

  it("forgets the failures of an email that signs in, and of one quiet for a day", () => {
    let now = 0;
    const lockout = createLockout({ now: () => now });
    for (let i = 0; i < 4; i++) lockout.failed("c@example.com");
    lockout.succeeded("c@example.com");
    lockout.failed("c@example.com");
    expect(lockout.retryAfterSeconds("c@example.com")).toBe(0);
    for (let i = 0; i < 4; i++) lockout.failed("d@example.com");
    now += 24 * 60 * MINUTE + 1;
    lockout.failed("d@example.com");
    expect(lockout.retryAfterSeconds("d@example.com")).toBe(0);
  });

  it("keeps at most the given number of emails, dropping the oldest", () => {
    const lockout = createLockout({ now: () => 0, maxEntries: 2 });
    for (const email of ["e1@example.com", "e2@example.com", "e3@example.com"]) {
      for (let i = 0; i < 5; i++) lockout.failed(email);
    }
    expect(lockout.retryAfterSeconds("e1@example.com")).toBe(0);
    expect(lockout.retryAfterSeconds("e3@example.com")).toBe(60);
  });

  it("drops an email that is not locked before one that is", () => {
    const lockout = createLockout({ now: () => 0, maxEntries: 2 });
    for (let i = 0; i < 5; i++) lockout.failed("target@example.com");
    for (let i = 0; i < 100; i++) lockout.failed(`junk-${String(i)}@example.com`);
    expect(lockout.retryAfterSeconds("target@example.com")).toBe(60);
  });

  it("begin counts the attempt at once, so attempts running together cannot pass the lock", () => {
    const lockout = createLockout({ now: () => 0 });
    // Five attempts start before any of them has an answer: the sixth is refused.
    for (let i = 0; i < 5; i++) expect(lockout.begin("f@example.com")).toBe(0);
    expect(lockout.begin("F@example.com")).toBe(60);
    // Refused attempts are not counted again.
    expect(lockout.begin("f@example.com")).toBe(60);
    lockout.succeeded("f@example.com");
    expect(lockout.begin("f@example.com")).toBe(0);
  });
});
