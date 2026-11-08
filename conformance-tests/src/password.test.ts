/**
 * Password sign-in on the local user directory (`pnpm test:conformance:password`): the first admin
 * from ADMIN_EMAIL and ADMIN_PASSWORD, the forced change, the same answer for a wrong password and
 * an unknown email, the back-off, and a password change ending the other sessions.
 *
 * Runs only when the setup created the first admin (`CONFORMANCE_AUTH=password`); the other runs
 * skip it. The tests run in order: the last ones change the admin's password.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, inject, it } from "vitest";
import { call, codeOf } from "./harness.js";
import { CookieJar } from "./sign-in.js";

const admin = inject("passwordAdmin");
const NEW_PASSWORD = "the admin's own new password";

interface Session {
  readonly jar: CookieJar;
  readonly headers: Record<string, string>;
}

async function login(email: string, password: string): Promise<Response> {
  return call("POST", "/auth/password/login", { body: { email, password } });
}

/** Signs in and returns the browser's cookies, with the CSRF header. */
async function signedIn(email: string, password: string): Promise<Session> {
  const response = await login(email, password);
  expect(response.status).toBe(204);
  const jar = new CookieJar();
  jar.store(response);
  expect(jar.get("msid")).toBeDefined();
  expect(jar.get("msid_csrf")).toBeDefined();
  return { jar, headers: { cookie: jar.header(), "x-csrf-token": jar.get("msid_csrf") ?? "" } };
}

/** An email no account has, new for each test, so no test's failures lock another's email out. */
const unknownEmail = () => `nobody-${randomBytes(4).toString("hex")}@example.com`;

describe.skipIf(admin === null)("password sign-in", () => {
  const { email, password } = admin ?? { email: "", password: "" };

  it("signs the first admin in, who must change the password first", async () => {
    const session = await signedIn(email.toUpperCase(), password);

    const me = await call("GET", "/me", { headers: session.headers });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      email,
      instanceRole: "admin",
      mustChangePassword: true,
    });

    const refused = await call("GET", "/surveys", {
      path: "/surveys?project=personal",
      headers: session.headers,
    });
    expect(refused.status).toBe(401);
    expect(await codeOf(refused)).toBe("password-change-required");
  });

  it("gives a wrong password and an unknown email the same answer", async () => {
    const wrong = await login(email, "not the admin's password");
    const unknown = await login(unknownEmail(), "not the admin's password");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it("answers 429 account-locked with Retry-After after five failures for an email", async () => {
    const locked = unknownEmail();
    for (let i = 0; i < 5; i++) {
      const failed = await login(locked, "not the password at all");
      expect(failed.status).toBe(401);
      expect(await codeOf(failed)).toBe("invalid-credentials");
    }
    const refused = await login(locked, "not the password at all");
    expect(refused.status).toBe(429);
    expect(await codeOf(refused)).toBe("account-locked");
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("answers 410 link-invalid for a set-password link nobody issued", async () => {
    const response = await call("POST", "/auth/password-link", {
      body: { token: randomBytes(24).toString("base64url"), password: NEW_PASSWORD },
    });
    expect(response.status).toBe(410);
    expect(await codeOf(response)).toBe("link-invalid");
  });

  it("refuses a wrong current password, a weak new one and the current one", async () => {
    const session = await signedIn(email, password);
    const wrong = await call("POST", "/me/password", {
      headers: session.headers,
      body: { currentPassword: "not the admin's password", newPassword: NEW_PASSWORD },
    });
    expect(wrong.status).toBe(403);
    expect(await codeOf(wrong)).toBe("invalid-credentials");
    const weak = await call("POST", "/me/password", {
      headers: session.headers,
      body: { currentPassword: password, newPassword: "password1234" },
    });
    expect(weak.status).toBe(422);
    expect(await codeOf(weak)).toBe("password-too-weak");
    // The current password cannot be kept, so the one from ADMIN_PASSWORD never survives.
    const same = await call("POST", "/me/password", {
      headers: session.headers,
      body: { currentPassword: password, newPassword: password },
    });
    expect(same.status).toBe(422);
    expect(await codeOf(same)).toBe("password-too-weak");
  });

  it("changes the password: a new session, the other sessions end, the old password stops", async () => {
    const other = await signedIn(email, password);
    const session = await signedIn(email, password);

    const changed = await call("POST", "/me/password", {
      headers: session.headers,
      body: { currentPassword: password, newPassword: NEW_PASSWORD },
    });
    expect(changed.status).toBe(204);
    const jar = new CookieJar();
    jar.store(changed);
    const renewed = { cookie: jar.header(), "x-csrf-token": jar.get("msid_csrf") ?? "" };

    // The change drops the server's cached check of the user, so both old sessions end at once
    // (the cache would otherwise keep them for up to a minute).
    const old = await call("GET", "/me", { headers: session.headers });
    expect(old.status).toBe(401);
    const otherMe = await call("GET", "/me", { headers: other.headers });
    expect(otherMe.status).toBe(401);

    const me = await call("GET", "/me", { headers: renewed });
    expect(await me.json()).toMatchObject({ mustChangePassword: false });
    const surveys = await call("GET", "/surveys", {
      path: "/surveys?project=personal",
      headers: renewed,
    });
    expect(surveys.status).toBe(200);

    expect((await login(email, password)).status).toBe(401);
    expect((await login(email, NEW_PASSWORD)).status).toBe(204);
  });
});
