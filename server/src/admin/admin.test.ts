import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { CSRF_COOKIE, SESSION_COOKIE } from "../auth/cookies.js";
import { loadConfig } from "../config.js";
import { createProviders } from "../providers/index.js";
import { PROJECT_A_ID } from "../providers/suite/expected.js";

const ADMIN_EMAIL = "first-admin@example.com";
const ADMIN_PASSWORD = "first admin password";
const NEW_PASSWORD = "the new user's password";
const DAY = 24 * 60 * 60 * 1000;

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
  expect(value(SESSION_COOKIE)).not.toBe("");
  return {
    cookie: `${SESSION_COOKIE}=${value(SESSION_COOKIE)}; ${CSRF_COOKIE}=${value(CSRF_COOKIE)}`,
    csrf: value(CSRF_COOKIE),
  };
}

/** The token of a set-password link. */
const tokenOf = (url: string) => new URL(url).searchParams.get("token") ?? "";

describe("the instance admin's user management", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
  });

  /** A memory instance with the legacy fixtures, passwords, and the first admin, signed in. */
  async function start() {
    let now = Date.parse("2026-10-29T10:00:00.000Z");
    const config = loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      USER_DIRECTORY: "local",
      AUTH_METHODS: "password",
      MEMORY_SEED: "legacy-fixtures",
      PUBLIC_BASE_URL: "https://studio.example.com",
      SESSION_SECRET: "a-test-only-session-secret-of-32-chars-or-more",
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
    });
    const app = await buildApp(config, await createProviders(config), { now: () => now });
    apps.push(app);
    const login = (email: string, password: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/auth/password/login",
        payload: { email, password },
      });
    const as = (
      session: Session | null,
      method: "GET" | "POST" | "PATCH" | "DELETE",
      url: string,
      payload?: Record<string, unknown>,
    ) =>
      app.inject({
        method,
        url: `/api/v1${url}`,
        headers: session ? { cookie: session.cookie, "x-csrf-token": session.csrf } : {},
        ...(payload !== undefined && { payload }),
      });
    const setPassword = (token: string, password: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/auth/password-link",
        payload: { token, password },
      });
    // The first admin changes the password from the settings, as it must.
    const first = sessionOf(await login(ADMIN_EMAIL, ADMIN_PASSWORD));
    const changed = await as(first, "POST", "/me/password", {
      currentPassword: ADMIN_PASSWORD,
      newPassword: "the admin's own password",
    });
    expect(changed.statusCode).toBe(204);
    const admin = sessionOf(changed);
    /** Creates a user, sets the password with the link, signs in; returns the user and session. */
    const newUser = async (name: string, instanceRole: "admin" | "user" = "user") => {
      const email = `${name.toLowerCase()}@example.com`;
      const created = await as(admin, "POST", "/admin/users", {
        email,
        displayName: name,
        instanceRole,
      });
      expect(created.statusCode).toBe(201);
      const body = created.json<{ user: { id: string }; link: { url: string } }>();
      expect((await setPassword(tokenOf(body.link.url), NEW_PASSWORD)).statusCode).toBe(204);
      const signedIn = await login(email, NEW_PASSWORD);
      expect(signedIn.statusCode).toBe(204);
      return { id: body.user.id, email, session: sessionOf(signedIn) };
    };
    return {
      app,
      admin,
      login,
      as,
      setPassword,
      newUser,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it("creates a user with a one-time link that sets the password and makes them active", async () => {
    const { admin, as, setPassword, login } = await start();
    const created = await as(admin, "POST", "/admin/users", {
      email: "Nina@Example.com",
      displayName: "Nina",
    });
    expect(created.statusCode).toBe(201);
    const body = created.json<{
      user: { id: string };
      link: { url: string; expiresAt: string };
    }>();
    expect(created.headers.location).toBe(`/api/v1/admin/users/${body.user.id}`);
    expect(body.user).toMatchObject({
      email: "nina@example.com",
      displayName: "Nina",
      instanceRole: "user",
      status: "invited",
      lastSignInAt: null,
      createdAt: "2026-10-29T10:00:00.000Z",
    });
    // 128 random bits, base64url.
    expect(body.link.url).toMatch(
      /^https:\/\/studio\.example\.com\/set-password\?token=[A-Za-z0-9_-]{22}$/,
    );
    expect(body.link.expiresAt).toBe("2026-11-05T10:00:00.000Z");

    const listed = await as(admin, "GET", "/admin/users");
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ items: { email: string; status: string }[] }>().items).toContainEqual(
      expect.objectContaining({ email: "nina@example.com", status: "invited" }),
    );

    expect((await login("nina@example.com", NEW_PASSWORD)).statusCode).toBe(401);
    expect((await setPassword(tokenOf(body.link.url), NEW_PASSWORD)).statusCode).toBe(204);
    expect((await login("nina@example.com", NEW_PASSWORD)).statusCode).toBe(204);
    const used = await setPassword(tokenOf(body.link.url), "another long password");
    expect(used.statusCode).toBe(410);
    expect(used.json()).toMatchObject({ code: "link-invalid" });

    const again = await as(admin, "POST", "/admin/users", {
      email: "NINA@example.com",
      displayName: "Nina again",
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: "email-taken" });
  });

  it("signs the user in with the password set from a link (S19), unless disabled", async () => {
    const { admin, as, setPassword } = await start();
    const created = await as(admin, "POST", "/admin/users", {
      email: "joiner@example.com",
      displayName: "Joiner",
    });
    const body = created.json<{ user: { id: string }; link: { url: string } }>();
    const joined = await setPassword(tokenOf(body.link.url), NEW_PASSWORD);
    expect(joined.statusCode).toBe(204);
    const me = await as(sessionOf(joined), "GET", "/me");
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: "joiner@example.com", mustChangePassword: false });

    // A disabled user's link still sets the password, but signs nobody in.
    await as(admin, "PATCH", `/admin/users/${body.user.id}`, { status: "disabled" });
    const reset = await as(admin, "POST", `/admin/users/${body.user.id}/reset-link`);
    const disabled = await setPassword(
      tokenOf(reset.json<{ url: string }>().url),
      "a disabled user's password",
    );
    expect(disabled.statusCode).toBe(204);
    expect(disabled.headers["set-cookie"]).toBeUndefined();
  });

  it("answers 410 for a link after its 7 days", async () => {
    const { admin, as, setPassword, advance } = await start();
    const created = await as(admin, "POST", "/admin/users", {
      email: "late@example.com",
      displayName: "Late",
    });
    advance(7 * DAY + 1);
    const late = await setPassword(
      tokenOf(created.json<{ link: { url: string } }>().link.url),
      NEW_PASSWORD,
    );
    expect(late.statusCode).toBe(410);
  });

  it("lists the users by email in pages, with their last sign-in", async () => {
    const { admin, as, newUser } = await start();
    const { email } = await newUser("Pia");
    const all: { email: string; lastSignInAt: string | null }[] = [];
    let cursor: string | null = null;
    do {
      const page = await as(
        admin,
        "GET",
        `/admin/users?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(page.statusCode).toBe(200);
      const body = page.json<{ items: typeof all; nextCursor: string | null }>();
      expect(body.items.length).toBeLessThanOrEqual(2);
      all.push(...body.items);
      cursor = body.nextCursor;
    } while (cursor !== null);
    const emails = all.map((user) => user.email);
    expect(emails).toEqual([...emails].sort());
    expect(new Set(emails).size).toBe(emails.length);
    expect(all.find((user) => user.email === email)?.lastSignInAt).toBe("2026-10-29T10:00:00.000Z");
    expect(emails).toContain("instance-admin@example.com");
  });

  it("refuses the admin operations to a user who is not an instance admin", async () => {
    const { as, newUser } = await start();
    const { session } = await newUser("Uma");
    const refused = await as(session, "GET", "/admin/users");
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: "forbidden" });
    expect((await as(null, "GET", "/admin/users")).statusCode).toBe(401);
    const create = await as(session, "POST", "/admin/users", {
      email: "x@example.com",
      displayName: "X",
    });
    expect(create.statusCode).toBe(403);
    // The destructive ones too, on a real user, so a 404 cannot hide a missing check.
    const { id: target } = await newUser("Tia");
    for (const [method, url, payload] of [
      ["PATCH", `/admin/users/${target}`, { status: "disabled" }],
      ["DELETE", `/admin/users/${target}`, undefined],
      ["POST", `/admin/users/${target}/reset-link`, undefined],
    ] as const) {
      const refusedWrite = await as(session, method, url, payload);
      expect(refusedWrite.statusCode).toBe(403);
      expect(refusedWrite.json()).toMatchObject({ code: "forbidden" });
    }
  });

  it("disables a user (their session ends), and enables them again", async () => {
    const { admin, as, login, newUser } = await start();
    const { id, email, session } = await newUser("Dora");
    const disabled = await as(admin, "PATCH", `/admin/users/${id}`, { status: "disabled" });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toMatchObject({ status: "disabled" });
    expect((await as(session, "GET", "/me")).statusCode).toBe(401);
    expect((await login(email, NEW_PASSWORD)).statusCode).toBe(401);

    const enabled = await as(admin, "PATCH", `/admin/users/${id}`, { status: "active" });
    expect(enabled.json()).toMatchObject({ status: "active" });
    expect((await login(email, NEW_PASSWORD)).statusCode).toBe(204);
    expect(
      (await as(admin, "PATCH", `/admin/users/${crypto.randomUUID()}`, { status: "active" }))
        .statusCode,
    ).toBe(404);
  });

  it("makes another admin, and never takes the last active admin away", async () => {
    const { admin, as, newUser } = await start();
    const list = await as(admin, "GET", "/admin/users");
    const me = list
      .json<{ items: { id: string; email: string }[] }>()
      .items.find((user) => user.email === ADMIN_EMAIL)!;
    // The seed's admin counts too: disable it, so the first admin is the only active one.
    const seedAdmin = "11111111-0000-4000-8000-a00000000007";
    expect(
      (await as(admin, "PATCH", `/admin/users/${seedAdmin}`, { status: "disabled" })).statusCode,
    ).toBe(200);

    for (const patch of [{ instanceRole: "user" }, { status: "disabled" }]) {
      const refused = await as(admin, "PATCH", `/admin/users/${me.id}`, patch);
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ code: "last-instance-admin" });
    }
    const deleted = await as(admin, "DELETE", `/admin/users/${me.id}`);
    expect(deleted.statusCode).toBe(409);

    const { id, session } = await newUser("Abe");
    const promoted = await as(admin, "PATCH", `/admin/users/${id}`, { instanceRole: "admin" });
    expect(promoted.json()).toMatchObject({ instanceRole: "admin" });
    // The promotion reaches Abe's session at once on this server.
    expect((await as(session, "GET", "/admin/users")).statusCode).toBe(200);
    expect(
      (await as(admin, "PATCH", `/admin/users/${me.id}`, { instanceRole: "user" })).statusCode,
    ).toBe(200);
  });

  it("resets a password: the session and the old password end, the new link works", async () => {
    const { admin, as, login, setPassword, newUser } = await start();
    const { id, email, session } = await newUser("Rex");
    const reset = await as(admin, "POST", `/admin/users/${id}/reset-link`);
    expect(reset.statusCode).toBe(201);
    const link = reset.json<{ url: string; expiresAt: string }>();
    expect(link.url).toMatch(/\/set-password\?token=[A-Za-z0-9_-]{22}$/);
    expect((await as(session, "GET", "/me")).statusCode).toBe(401);
    expect((await login(email, NEW_PASSWORD)).statusCode).toBe(401);
    expect((await setPassword(tokenOf(link.url), "Rex's brand new password")).statusCode).toBe(204);
    expect((await login(email, "Rex's brand new password")).statusCode).toBe(204);
    expect(
      (await as(admin, "POST", `/admin/users/${crypto.randomUUID()}/reset-link`)).statusCode,
    ).toBe(404);
  });

  it("deletes a user with their personal surveys", async () => {
    const { admin, as, newUser } = await start();
    const { id, session } = await newUser("Del");
    const survey = await as(session, "POST", "/surveys", { name: "Del's survey" });
    expect(survey.statusCode).toBe(201);
    const surveyId = survey.json<{ id: string }>().id;

    expect((await as(admin, "DELETE", `/admin/users/${id}`)).statusCode).toBe(204);
    expect((await as(session, "GET", "/me")).statusCode).toBe(401);
    expect((await as(admin, "GET", `/surveys/${surveyId}`)).statusCode).toBe(404);
    const users = (await as(admin, "GET", "/admin/users")).json<{ items: { id: string }[] }>();
    expect(users.items.map((user) => user.id)).not.toContain(id);
    expect((await as(admin, "DELETE", `/admin/users/${id}`)).statusCode).toBe(404);
  });

  it("lets an instance admin see and manage every project", async () => {
    const { admin, as, newUser } = await start();
    const mine = await as(admin, "GET", "/projects");
    expect(mine.json<{ items: unknown[] }>().items).toEqual([]);
    const all = await as(admin, "GET", "/projects?scope=all");
    expect(all.statusCode).toBe(200);
    expect(all.json<{ items: { id: string; role: string }[] }>().items).toContainEqual(
      expect.objectContaining({ id: PROJECT_A_ID, role: "admin" }),
    );
    expect((await as(admin, "GET", `/projects/${PROJECT_A_ID}`)).json()).toMatchObject({
      role: "admin",
    });
    const renamed = await as(admin, "PATCH", `/projects/${PROJECT_A_ID}`, { name: "Renamed" });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ name: "Renamed", role: "admin" });
    expect((await as(admin, "GET", `/projects/${PROJECT_A_ID}/members`)).statusCode).toBe(200);

    const { session } = await newUser("Ned");
    expect((await as(session, "GET", "/projects?scope=all")).statusCode).toBe(403);
    expect((await as(session, "GET", `/projects/${PROJECT_A_ID}`)).statusCode).toBe(404);
  });
});
