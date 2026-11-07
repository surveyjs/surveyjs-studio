import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createProviders } from "../providers/index.js";
import { CSRF_COOKIE, SESSION_COOKIE } from "./cookies.js";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "first admin password";
const NEW_PASSWORD = "a brand new password";

const localEnv = (extra: Record<string, string> = {}) => ({
  NODE_ENV: "test",
  LOG_LEVEL: "info",
  USER_DIRECTORY: "local",
  AUTH_METHODS: "password",
  ...extra,
});

interface Session {
  readonly cookie: string;
  readonly csrf: string;
}

/** The session and CSRF cookies a response sets. */
function sessionOf(response: LightMyRequestResponse): Session {
  const set = [response.headers["set-cookie"]].flat().filter((c): c is string => !!c);
  const value = (name: string) =>
    set
      .find((c) => c.startsWith(`${name}=`))
      ?.split(";")[0]
      ?.slice(name.length + 1) ?? "";
  const session = value(SESSION_COOKIE);
  const csrf = value(CSRF_COOKIE);
  expect(session).not.toBe("");
  return { cookie: `${SESSION_COOKIE}=${session}; ${CSRF_COOKIE}=${csrf}`, csrf };
}

describe("password sign-in", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
  });

  async function start(env: Record<string, string> = {}) {
    const lines: string[] = [];
    const config = loadConfig(localEnv(env));
    const app = await buildApp(config, await createProviders(config), {
      logStream: { write: (line) => lines.push(line) },
    });
    apps.push(app);
    const login = (email: string, password: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/auth/password/login",
        payload: { email, password },
      });
    const as = (
      session: Session,
      method: "GET" | "POST",
      url: string,
      payload?: Record<string, string>,
    ) =>
      app.inject({
        method,
        url: `/api/v1${url}`,
        headers: { cookie: session.cookie, "x-csrf-token": session.csrf },
        ...(payload !== undefined && { payload }),
      });
    return { app, lines, login, as };
  }

  it("signs the first admin in, forces a password change, then ends the old session", async () => {
    const { login, as } = await start({ ADMIN_EMAIL, ADMIN_PASSWORD });
    const signedIn = await login("Admin@Example.com", ADMIN_PASSWORD);
    expect(signedIn.statusCode).toBe(204);
    const first = sessionOf(signedIn);

    const me = await as(first, "GET", "/me");
    expect(me.json()).toMatchObject({
      email: ADMIN_EMAIL,
      instanceRole: "admin",
      mustChangePassword: true,
    });
    const refused = await as(first, "GET", "/surveys?project=personal");
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toMatchObject({ code: "password-change-required" });

    const changed = await as(first, "POST", "/me/password", {
      currentPassword: ADMIN_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(changed.statusCode).toBe(204);
    const second = sessionOf(changed);

    expect((await as(first, "GET", "/me")).statusCode).toBe(401);
    expect((await as(second, "GET", "/me")).json()).toMatchObject({ mustChangePassword: false });
    expect((await as(second, "GET", "/surveys?project=personal")).statusCode).toBe(200);
    expect((await login(ADMIN_EMAIL, ADMIN_PASSWORD)).statusCode).toBe(401);
    expect((await login(ADMIN_EMAIL, NEW_PASSWORD)).statusCode).toBe(204);
  });

  it("gives a wrong password and an unknown email the same answer", async () => {
    const { login } = await start({ ADMIN_EMAIL, ADMIN_PASSWORD });
    const wrong = await login(ADMIN_EMAIL, "not the password at all");
    const unknown = await login("nobody@example.com", "not the password at all");
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.json()).toMatchObject({ code: "invalid-credentials" });
  });

  it("locks an email out after 5 failures, known or not, with Retry-After", async () => {
    const { login } = await start({ ADMIN_EMAIL, ADMIN_PASSWORD });
    for (const email of [ADMIN_EMAIL, "nobody@example.com"]) {
      for (let i = 0; i < 5; i++)
        expect((await login(email, "wrong password!!")).statusCode).toBe(401);
      const locked = await login(email, email === ADMIN_EMAIL ? ADMIN_PASSWORD : "anything");
      expect(locked.statusCode).toBe(429);
      expect(locked.json()).toMatchObject({ code: "account-locked" });
      expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
    }
  });

  it("counts attempts that run at the same time, so a burst cannot pass the lock", async () => {
    const { login } = await start({ ADMIN_EMAIL, ADMIN_PASSWORD });
    const wrong = Array.from({ length: 8 }, () => login(ADMIN_EMAIL, "not the password at all"));
    const answers = await Promise.all([...wrong, login(ADMIN_EMAIL, ADMIN_PASSWORD)]);
    const statuses = answers.map((answer) => answer.statusCode);
    expect(statuses.filter((status) => status === 401)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(4);
    expect(statuses.at(-1)).toBe(429);
  });

  it("refuses the current password as the new one, so the configured one cannot stay", async () => {
    const { login, as } = await start({ ADMIN_EMAIL, ADMIN_PASSWORD });
    const session = sessionOf(await login(ADMIN_EMAIL, ADMIN_PASSWORD));
    const same = await as(session, "POST", "/me/password", {
      currentPassword: ADMIN_PASSWORD,
      newPassword: ADMIN_PASSWORD,
    });
    expect(same.statusCode).toBe(422);
    expect(same.json()).toMatchObject({
      code: "password-too-weak",
      detail: "Choose a password different from the current one.",
    });
    expect((await as(session, "GET", "/me")).json()).toMatchObject({ mustChangePassword: true });
  });

  it("forgets the failed attempts once the password is changed", async () => {
    const { login, as } = await start({ ADMIN_EMAIL, ADMIN_PASSWORD });
    const session = sessionOf(await login(ADMIN_EMAIL, ADMIN_PASSWORD));
    for (let i = 0; i < 4; i++) {
      const wrong = await as(session, "POST", "/me/password", {
        currentPassword: "not the current one",
        newPassword: NEW_PASSWORD,
      });
      expect(wrong.statusCode).toBe(403);
    }
    const changed = await as(session, "POST", "/me/password", {
      currentPassword: ADMIN_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(changed.statusCode).toBe(204);
    // Four failures were counted; without the reset a fifth would lock the email.
    expect((await login(ADMIN_EMAIL, "still not the password")).statusCode).toBe(401);
    expect((await login(ADMIN_EMAIL, NEW_PASSWORD)).statusCode).toBe(204);
  });

  it("refuses a wrong current password and a weak new one", async () => {
    const { login, as } = await start({ ADMIN_EMAIL, ADMIN_PASSWORD });
    const session = sessionOf(await login(ADMIN_EMAIL, ADMIN_PASSWORD));
    const wrong = await as(session, "POST", "/me/password", {
      currentPassword: "not the current one",
      newPassword: NEW_PASSWORD,
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toMatchObject({ code: "invalid-credentials" });
    const weak = await as(session, "POST", "/me/password", {
      currentPassword: ADMIN_PASSWORD,
      newPassword: "password1234",
    });
    expect(weak.statusCode).toBe(422);
    expect(weak.json()).toMatchObject({
      code: "password-too-weak",
      detail: "This password is too common. Choose another one.",
    });
  });

  it("logs a one-time setup link without ADMIN_*, which creates the first admin once", async () => {
    const { app, lines, login } = await start({ PUBLIC_BASE_URL: "http://localhost:5173" });
    const logged = lines.join("");
    const token = /\/set-password\?setup=([A-Za-z0-9_-]+)/.exec(logged)?.[1];
    expect(token).toBeDefined();
    const use = (payload: Record<string, string>) =>
      app.inject({ method: "POST", url: "/api/v1/auth/password-link", payload });

    const missing = await use({ token: token!, password: NEW_PASSWORD });
    expect(missing.statusCode).toBe(400);
    const created = await use({
      token: token!,
      password: NEW_PASSWORD,
      email: "Owner@Example.com",
      displayName: "Owner",
    });
    expect(created.statusCode).toBe(204);
    expect((await login("owner@example.com", NEW_PASSWORD)).statusCode).toBe(204);
    const again = await use({
      token: token!,
      password: NEW_PASSWORD,
      email: "other@example.com",
      displayName: "Other",
    });
    expect(again.statusCode).toBe(400);
    expect(again.json()).toMatchObject({ code: "link-invalid" });
  });

  it("keeps the setup link when its email already has an account", async () => {
    // The seed's users are accounts, none of them an admin, so the setup link is logged.
    const { app, lines, login } = await start({
      PUBLIC_BASE_URL: "http://localhost:5173",
      MEMORY_SEED: "legacy-fixtures",
    });
    const token = /\/set-password\?setup=([A-Za-z0-9_-]+)/.exec(lines.join(""))?.[1];
    expect(token).toBeDefined();
    const use = (email: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/auth/password-link",
        payload: { token: token!, password: NEW_PASSWORD, email, displayName: "Admin" },
      });

    const taken = await use("Owner@Example.com");
    expect(taken.statusCode).toBe(400);
    expect(taken.json()).toMatchObject({
      code: "bad-request",
      detail: "An account with this email exists. Choose another email.",
    });
    expect((await use("new-admin@example.com")).statusCode).toBe(204);
    expect((await login("new-admin@example.com", NEW_PASSWORD)).statusCode).toBe(204);
  });

  it("creates one admin when the setup link is used twice at once", async () => {
    const { app, lines, login } = await start({ PUBLIC_BASE_URL: "http://localhost:5173" });
    const token = /\/set-password\?setup=([A-Za-z0-9_-]+)/.exec(lines.join(""))?.[1];
    const use = (email: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/auth/password-link",
        payload: { token: token!, password: NEW_PASSWORD, email, displayName: "Admin" },
      });
    const answers = await Promise.all([use("one@example.com"), use("two@example.com")]);
    expect(answers.map((answer) => answer.statusCode).sort()).toEqual([204, 400]);
    const signIns = await Promise.all([
      login("one@example.com", NEW_PASSWORD),
      login("two@example.com", NEW_PASSWORD),
    ]);
    expect(signIns.map((answer) => answer.statusCode).sort()).toEqual([204, 401]);
  });

  it("sends the browser to the sign-in page when passwords are the only sign-in", async () => {
    const { app } = await start({
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      PUBLIC_BASE_URL: "http://localhost:5173",
    });
    const response = await app.inject("/api/v1/auth/login?returnTo=%2Fprojects");
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("http://localhost:5173/sign-in?returnTo=%2Fprojects");
  });
});
