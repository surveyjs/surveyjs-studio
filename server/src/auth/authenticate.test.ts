import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Security } from "../contract.js";
import { hashCredential, lastFour, newApiTokenValue } from "../credentials/format.js";
import { createOwnerCheck } from "../credentials/owner-check.js";
import { createBearerResolver } from "../credentials/resolve.js";
import type { ProjectRecord, User } from "../domain/types.js";
import { AppError } from "../errors.js";
import { createMemoryCredentials } from "../providers/memory-credentials.js";
import type { UserDirectory } from "../providers/types.js";
import {
  accessRule,
  authenticationHook,
  type AuthenticationOptions,
  type RequestUser,
} from "./authenticate.js";
import { generateCsrfToken } from "./csrf.js";
import { createSession, encodeSession } from "./session.js";

const SECRET = "x".repeat(32);
const COOKIE_READ: Security = [["cookieAuth"], ["bearerAuth"]];
const COOKIE_WRITE: Security = [["cookieAuth", "csrfToken"], ["bearerAuth"]];
const SESSION_ONLY: Security = [["cookieAuth", "csrfToken"]];
const BEARER_ONLY: Security = [["bearerAuth"]];

describe("accessRule", () => {
  it("marks the operations that list bearerAuth", () => {
    expect(accessRule(COOKIE_READ)).toEqual({ kind: "session", csrf: false, bearer: true });
    expect(accessRule(COOKIE_WRITE)).toEqual({ kind: "session", csrf: true, bearer: true });
    expect(accessRule(SESSION_ONLY)).toEqual({ kind: "session", csrf: true, bearer: false });
    expect(accessRule([["cookieAuth"]])).toEqual({ kind: "session", csrf: false, bearer: false });
    expect(accessRule([["cookieAuth", "csrfToken"], []])).toEqual({
      kind: "optional",
      csrf: true,
      bearer: false,
    });
  });

  it("gives the bearer-only requirement its own kind", () => {
    expect(accessRule(BEARER_ONLY)).toEqual({ kind: "bearer-only" });
    expect(accessRule([])).toEqual({ kind: "public" });
    expect(accessRule([["somethingElse"]])).toEqual({ kind: "never" });
  });
});

describe("RequestUser", () => {
  it("must carry a scope", () => {
    // @ts-expect-error a request user without a scope no longer type-checks
    const user: RequestUser = { id: "u", displayName: "U", email: "u@x", avatarUrl: null };
    expect(user.id).toBe("u");
  });
});

const owner: User = {
  id: randomUUID(),
  email: "owner@example.com",
  displayName: "Owner",
  blocked: false,
};

interface Setup {
  readonly app: FastifyInstance;
  readonly token: string;
  readonly tokenId: string;
  readonly revokedToken: string;
  readonly projectToken: string;
  readonly projectId: string;
  readonly touch: ReturnType<typeof vi.fn>;
  readonly setOwner: (user: User) => void;
  readonly advance: (ms: number) => void;
  readonly session: () => { cookie: string; "x-csrf-token": string };
}

let running: FastifyInstance | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function setup(): Promise<Setup> {
  let now = Date.parse("2026-11-18T10:00:00.000Z");
  const clock = () => now;
  let current = owner;
  const getUser = vi.fn((id: string) =>
    Promise.resolve(id.toLowerCase() === current.id ? current : null),
  );
  const users: UserDirectory = {
    kind: "external",
    getUser,
    findUserByEmail: () => Promise.resolve(null),
    signInUser: () => Promise.resolve(null),
    missingUsers: () => Promise.resolve([]),
  };
  const { store } = createMemoryCredentials({ [owner.id]: "0123456789abcdef0123456789abcdef" });
  const touch = vi.spyOn(store, "touchApiToken") as unknown as ReturnType<typeof vi.fn>;
  const add = async (projectId: string | null) => {
    const value = newApiTokenValue();
    const id = randomUUID();
    await store.createApiToken(
      {
        id,
        creatorId: owner.id,
        projectId,
        name: "CI",
        lastFour: lastFour(value),
        createdAt: "2026-11-18T09:00:00.000Z",
      },
      hashCredential(value, "api-token"),
    );
    return { id, value };
  };
  const personal = await add(null);
  const projectId = randomUUID();
  const project = await add(projectId);
  const revoked = await add(null);
  await store.revokeApiToken(revoked.id, "2026-11-18T09:30:00.000Z");

  const options: AuthenticationOptions = {
    sessionSecret: SECRET,
    now: clock,
    bearer: createBearerResolver({
      credentials: store,
      projects: { getProject: (id) => Promise.resolve({ id } as ProjectRecord) },
      owners: createOwnerCheck({ users, accounts: null, now: clock }),
      now: clock,
    }),
  };
  const app = Fastify();
  running = app;
  app.decorateRequest("user", null);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.status).send({ code: error.code });
    return reply.code(500).send({ code: "internal" });
  });
  const routes: [string, "GET" | "POST", Security][] = [
    ["/read", "GET", COOKIE_READ],
    ["/write", "POST", COOKIE_WRITE],
    ["/session-only", "POST", SESSION_ONLY],
    ["/me/credential", "POST", BEARER_ONLY],
  ];
  for (const [url, method, security] of routes) {
    const onRequest = authenticationHook(security, options, url);
    app.route({
      method,
      url,
      ...(onRequest && { onRequest }),
      handler: (request) => request.user,
    });
  }
  await app.ready();

  const session = () => {
    const csrf = generateCsrfToken();
    const payload = createSession(
      { sub: "session-user", name: "Session", email: "s@example.com", avatarUrl: null },
      csrf,
      3600,
      clock,
    );
    return {
      cookie: `msid=${encodeSession(SECRET, payload)}; msid_csrf=${csrf}`,
      "x-csrf-token": csrf,
    };
  };
  return {
    app,
    token: personal.value,
    tokenId: personal.id,
    projectToken: project.value,
    projectId,
    touch,
    setOwner: (user) => (current = user),
    advance: (ms) => (now += ms),
    session,
    revokedToken: revoked.value,
  };
}

const bearer = (value: string) => ({ authorization: `Bearer ${value}` });

describe("authenticationHook with bearer credentials", () => {
  it("authenticates an API token and sets its scope and credential", async () => {
    const { app, token, tokenId } = await setup();
    const res = await app.inject({ url: "/read", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: owner.id,
      displayName: "Owner",
      email: "owner@example.com",
      avatarUrl: null,
      scope: { kind: "personal" },
      credential: { kind: "api-token", id: tokenId },
    });
  });

  it("skips CSRF for a bearer write", async () => {
    const { app, projectToken, projectId } = await setup();
    const res = await app.inject({ method: "POST", url: "/write", headers: bearer(projectToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().scope).toEqual({ kind: "project", projectId });
  });

  it("uses the bearer credential when a cookie comes with it", async () => {
    const { app, token, session } = await setup();
    const { cookie } = session();
    const res = await app.inject({
      method: "POST",
      url: "/write",
      headers: { ...bearer(token), cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(owner.id);
    // A bad bearer value is not saved by a valid session.
    const bad = await app.inject({
      method: "POST",
      url: "/write",
      headers: { ...bearer(newApiTokenValue()), ...session() },
    });
    expect(bad.statusCode).toBe(401);
  });

  it("gives a session the scope of everything and the session credential", async () => {
    const { app, session } = await setup();
    const res = await app.inject({ method: "POST", url: "/write", headers: session() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: "session-user",
      scope: { kind: "all" },
      credential: { kind: "session" },
    });
  });

  it("authenticates a legacy key with the scope of everything", async () => {
    const { app } = await setup();
    const res = await app.inject({
      url: "/read",
      headers: bearer("0123456789ABCDEF0123456789ABCDEF"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: owner.id,
      scope: { kind: "all" },
      credential: { kind: "legacy-key" },
    });
  });

  it("answers 401 for an unknown, revoked or malformed value and never echoes it", async () => {
    const { app, revokedToken } = await setup();
    const unknown = newApiTokenValue();
    for (const authorization of [
      `Bearer ${unknown}`,
      `Bearer ${revokedToken}`,
      "Bearer ffffffffffffffffffffffffffffffff",
      "Bearer sjs_short",
      "Bearer",
      "Bearer ",
      `Bearer ${unknown} extra`,
    ]) {
      const res = await app.inject({ url: "/read", headers: { authorization } });
      expect(res.statusCode, authorization).toBe(401);
      expect(res.json()).toEqual({ code: "unauthenticated" });
      expect(res.body).not.toContain(unknown);
    }
  });

  it("treats another scheme as no bearer credential: the session rules apply", async () => {
    const { app, token, session } = await setup();
    const basic = { authorization: `Basic ${Buffer.from(`u:${token}`).toString("base64")}` };
    expect((await app.inject({ url: "/read", headers: basic })).statusCode).toBe(401);
    const withSession = await app.inject({ url: "/read", headers: { ...basic, ...session() } });
    expect(withSession.statusCode).toBe(200);
    expect(withSession.json().id).toBe("session-user");
  });

  it("ignores the bearer header on a session-only operation", async () => {
    const { app, token, session } = await setup();
    expect(
      (await app.inject({ method: "POST", url: "/session-only", headers: bearer(token) }))
        .statusCode,
    ).toBe(401);
    const res = await app.inject({
      method: "POST",
      url: "/session-only",
      headers: { ...bearer(token), ...session() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: "session-user", credential: { kind: "session" } });
  });

  it("accepts only a bearer credential where the operation is bearer-only", async () => {
    const { app, token, session, tokenId } = await setup();
    const signedIn = await app.inject({
      method: "POST",
      url: "/me/credential",
      headers: session(),
    });
    expect(signedIn.statusCode).toBe(401);
    const res = await app.inject({ method: "POST", url: "/me/credential", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().credential).toEqual({ kind: "api-token", id: tokenId });
  });

  it("refuses a blocked owner, with the check cached for at most 60 seconds", async () => {
    const { app, token, setOwner, advance } = await setup();
    expect((await app.inject({ url: "/read", headers: bearer(token) })).statusCode).toBe(200);
    setOwner({ ...owner, blocked: true });
    advance(59_000);
    expect((await app.inject({ url: "/read", headers: bearer(token) })).statusCode).toBe(200);
    advance(1_000);
    expect((await app.inject({ url: "/read", headers: bearer(token) })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: "/read",
          headers: bearer("0123456789abcdef0123456789abcdef"),
        })
      ).statusCode,
    ).toBe(401);
  });

  it("writes last used once for two requests within a minute", async () => {
    const { app, token, tokenId, touch, advance } = await setup();
    await app.inject({ url: "/read", headers: bearer(token) });
    advance(20_000);
    await app.inject({ method: "POST", url: "/write", headers: bearer(token) });
    expect(touch).toHaveBeenCalledOnce();
    expect(touch).toHaveBeenCalledWith(tokenId, "2026-11-18T10:00:00.000Z");
  });
});
