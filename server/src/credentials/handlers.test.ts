/**
 * The API token operations over HTTP on a memory store (ADR 0037): who lists, creates and revokes
 * which tokens, the legacy key's Revoke behind `LEGACY_KEY_REVOKE`, and the bearer-only
 * replacement of the request's own credential.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createDevIdentityProvider } from "../auth/providers/dev.js";
import { signIn } from "../auth/testing.js";
import { loadConfig } from "../config.js";
import type { User } from "../domain/types.js";
import { createMemoryProviders, type MemorySeed } from "../providers/memory.js";
import { seedInstanceAdmin } from "../providers/seed-instance-admin.js";
import type { CredentialStore, ProviderSet } from "../providers/types.js";

const NOW = "2026-11-18T12:00:00.000Z";

const user = (n: number, displayName: string): User => ({
  id: `aaaaaaaa-0000-4000-8000-00000000000${n}`,
  email: `${displayName.toLowerCase()}@example.test`,
  displayName,
  blocked: false,
});

const ANN = user(1, "Ann");
const BOB = user(2, "Bob");
const CARA = user(3, "Cara");
const TEAM = "bbbbbbbb-0000-4000-8000-000000000001";
const OTHER = "bbbbbbbb-0000-4000-8000-000000000002";
/** Matched without regard to letter case. */
const ANN_KEY = "Legacy-Key-Ann";

const seed: MemorySeed = {
  users: [ANN, BOB, CARA],
  surveys: [],
  projects: [
    { id: TEAM, name: "Team", creatorId: ANN.id, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: OTHER, name: "Other", creatorId: CARA.id, createdAt: "2026-01-01T00:00:00.000Z" },
  ],
  memberships: [
    { userId: ANN.id, projectId: TEAM, role: "admin" },
    { userId: BOB.id, projectId: TEAM, role: "user" },
    { userId: CARA.id, projectId: OTHER, role: "admin" },
  ],
  legacyAccessKeys: { [ANN.id]: ANN_KEY },
};

type Headers = Record<string, string>;

interface TokenJson {
  id: string;
  name: string;
  projectId: string | null;
  lastFour: string;
  createdAt: string;
  lastUsedAt: string | null;
  createdBy: { id: string; displayName: string };
}

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

interface StartOptions {
  readonly env?: Record<string, string>;
  readonly userDirectory?: "external" | "local";
  readonly wrap?: (providers: ProviderSet) => ProviderSet;
}

async function start(options: StartOptions = {}) {
  const config = loadConfig({ NODE_ENV: "test", IDENTITY_PROVIDER: "dev", ...options.env });
  const memory = createMemoryProviders(seed, {
    userDirectory: options.userDirectory ?? "external",
  });
  const providers = options.wrap ? options.wrap(memory) : memory;
  const server = await buildApp(config, providers, {
    identity: createDevIdentityProvider({
      publicBaseUrl: config.publicBaseUrl,
      users: [...seed.users, seedInstanceAdmin],
    }),
    now: () => Date.parse(NOW),
  });
  app = server;
  const sessions = new Map<string, Headers>();
  const as = async (u: User): Promise<Headers> => {
    let headers = sessions.get(u.id);
    if (!headers) {
      headers = { ...(await signIn(server, u.id)).headers };
      sessions.set(u.id, headers);
    }
    return headers;
  };
  const send = (
    method: "GET" | "POST" | "DELETE",
    url: string,
    headers: Headers,
    payload?: object,
  ) => server.inject({ method, url: `/api/v1${url}`, headers, ...(payload && { payload }) });
  const create = async (u: User, projectId: string | null, name = "CI") => {
    const res = await send("POST", "/api-tokens", await as(u), { name, projectId });
    expect(res.statusCode).toBe(201);
    return res.json<{ token: TokenJson; value: string }>();
  };
  return { server, providers: memory, as, send, create };
}

const bearer = (value: string): Headers => ({ authorization: `Bearer ${value}` });

describe("createApiToken", () => {
  it("creates a Personal token and shows its value once", async () => {
    const { create } = await start();
    const { token, value } = await create(ANN, null, "Deploy");
    expect(value).toMatch(/^sjs_[A-Za-z0-9_-]{43}$/);
    expect(token).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "Deploy",
      projectId: null,
      lastFour: value.slice(-4),
      createdAt: NOW,
      lastUsedAt: null,
      createdBy: { id: ANN.id, displayName: "Ann" },
    });
  });

  it("creates a project token for a project admin only: 403 for a member, 404 for others", async () => {
    const { as, send, create } = await start();
    const { token } = await create(ANN, TEAM.toUpperCase());
    expect(token.projectId).toBe(TEAM);
    const member = await send("POST", "/api-tokens", await as(BOB), {
      name: "CI",
      projectId: TEAM,
    });
    expect(member.statusCode).toBe(403);
    expect(member.json()).toMatchObject({ code: "forbidden" });
    for (const projectId of [OTHER, randomUUID()]) {
      const res = await send("POST", "/api-tokens", await as(BOB), { name: "CI", projectId });
      expect(res.statusCode, projectId).toBe(404);
      expect(res.json()).toMatchObject({ code: "not-found" });
    }
  });

  it("refuses a blank name with 422", async () => {
    const { as, send } = await start();
    const res = await send("POST", "/api-tokens", await as(ANN), { name: "  ", projectId: null });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: "validation-failed",
      errors: [{ pointer: "/name", detail: "must not be blank" }],
    });
  });

  it("refuses a bearer credential, and a session without its CSRF token", async () => {
    const { as, send, create } = await start();
    const { value } = await create(ANN, null);
    const byToken = await send("POST", "/api-tokens", bearer(value), {
      name: "CI",
      projectId: null,
    });
    expect(byToken.statusCode).toBe(401);
    const { cookie } = await as(ANN);
    const noCsrf = await send(
      "POST",
      "/api-tokens",
      { cookie: cookie! },
      { name: "CI", projectId: null },
    );
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json()).toMatchObject({ code: "csrf-token-invalid" });
  });
});

describe("listApiTokens", () => {
  it("lists the caller's Personal tokens newest first, with no value, and the legacy key", async () => {
    const { as, send, create, providers } = await start();
    const older = await create(ANN, null, "Older");
    await create(ANN, TEAM, "In the project");
    await create(BOB, null, "Bob's");
    // Created later: listed first.
    await providers.credentials.createApiToken(
      {
        id: randomUUID(),
        creatorId: ANN.id,
        projectId: null,
        name: "Newer",
        lastFour: "wxyz",
        createdAt: "2026-11-18T13:00:00.000Z",
      },
      "hash-newer",
    );
    const res = await send("GET", "/api-tokens", await as(ANN));
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(older.value);
    const body = res.json<{ legacyKey: unknown; tokens: TokenJson[] }>();
    expect(body.legacyKey).toEqual({ lastFour: "-ann", revocable: false });
    expect(body.tokens.map((t) => t.name)).toEqual(["Newer", "Older"]);
    expect(body.tokens[1]).toEqual(older.token);
  });

  it("marks the legacy key revocable when LEGACY_KEY_REVOKE is on, and has none for others", async () => {
    const { as, send } = await start({ env: { LEGACY_KEY_REVOKE: "true" } });
    const ann = await send("GET", "/api-tokens", await as(ANN));
    expect(ann.json()).toMatchObject({ legacyKey: { lastFour: "-ann", revocable: true } });
    const bob = await send("GET", "/api-tokens", await as(BOB));
    expect(bob.json()).toEqual({ legacyKey: null, tokens: [] });
  });

  it("lists a project's tokens, whoever created them, to its admins only", async () => {
    const { as, send, create, providers } = await start();
    const anns = await create(ANN, TEAM, "Ann's");
    // Bob's token of the project, made while he was an admin.
    await providers.credentials.createApiToken(
      {
        id: randomUUID(),
        creatorId: BOB.id,
        projectId: TEAM,
        name: "Bob's",
        lastFour: "bbbb",
        createdAt: "2026-11-18T11:00:00.000Z",
      },
      "hash-bob",
    );
    const res = await send("GET", `/api-tokens?project=${TEAM}`, await as(ANN));
    expect(res.statusCode).toBe(200);
    const body = res.json<{ legacyKey: unknown; tokens: TokenJson[] }>();
    expect(body.legacyKey).toBeNull();
    expect(body.tokens).toEqual([
      anns.token,
      expect.objectContaining({ name: "Bob's", createdBy: { id: BOB.id, displayName: "Bob" } }),
    ]);
    expect((await send("GET", `/api-tokens?project=${TEAM}`, await as(BOB))).statusCode).toBe(403);
    expect((await send("GET", `/api-tokens?project=${TEAM}`, await as(CARA))).statusCode).toBe(404);
  });

  it("names an unknown creator by their id", async () => {
    const { as, send, providers } = await start();
    const gone = randomUUID();
    await providers.credentials.createApiToken(
      {
        id: randomUUID(),
        creatorId: gone,
        projectId: TEAM,
        name: "Orphan",
        lastFour: "oooo",
        createdAt: NOW,
      },
      "hash-orphan",
    );
    const res = await send("GET", `/api-tokens?project=${TEAM}`, await as(ANN));
    expect(res.json()).toMatchObject({ tokens: [{ createdBy: { id: gone, displayName: gone } }] });
  });

  it("lets an instance admin act as an admin of every project (S17)", async () => {
    const { as, send } = await start({ userDirectory: "local" });
    const ivy = await as(seedInstanceAdmin);
    expect((await send("GET", `/api-tokens?project=${OTHER}`, ivy)).statusCode).toBe(200);
    const created = await send("POST", "/api-tokens", ivy, { name: "CI", projectId: OTHER });
    expect(created.statusCode).toBe(201);
    expect((await send("GET", `/api-tokens?project=${randomUUID()}`, ivy)).statusCode).toBe(404);
  });
});

describe("revokeApiToken", () => {
  it("revokes the caller's Personal token: it stops at once, and a repeat is 404", async () => {
    const { as, send, create } = await start();
    const { token, value } = await create(ANN, null);
    expect((await send("GET", "/surveys", bearer(value))).statusCode).toBe(200);
    const res = await send("DELETE", `/api-tokens/${token.id.toUpperCase()}`, await as(ANN));
    expect(res.statusCode).toBe(204);
    expect((await send("GET", "/surveys", bearer(value))).statusCode).toBe(401);
    expect((await send("DELETE", `/api-tokens/${token.id}`, await as(ANN))).statusCode).toBe(404);
  });

  it("answers 404 for a token out of reach: another user's Personal one or a project's to a member", async () => {
    const { as, send, create } = await start();
    const personal = await create(ANN, null);
    const project = await create(ANN, TEAM);
    const other = await create(CARA, OTHER);
    for (const [u, id] of [
      [BOB, personal.token.id],
      [BOB, project.token.id],
      [ANN, other.token.id],
      [ANN, randomUUID()],
    ] as const) {
      const res = await send("DELETE", `/api-tokens/${id}`, await as(u));
      expect(res.statusCode, `${u.displayName} ${id}`).toBe(404);
      expect(res.json()).toMatchObject({ code: "not-found" });
    }
    for (const { value } of [personal, project, other]) {
      expect((await send("GET", "/surveys", bearer(value))).statusCode).toBe(200);
    }
  });

  it("lets any admin of the project revoke its tokens, whoever made them", async () => {
    const { as, send, create, providers } = await start();
    const { token } = await create(ANN, TEAM);
    expect(await providers.projects.setMemberRole(TEAM, BOB.id, "admin", { now: NOW })).toBe(
      "changed",
    );
    expect((await send("DELETE", `/api-tokens/${token.id}`, await as(BOB))).statusCode).toBe(204);
  });

  it("does not let the creator of a project token revoke it once no longer an admin", async () => {
    const { as, send, create, providers } = await start();
    const { token } = await create(ANN, TEAM);
    await providers.projects.setMemberRole(TEAM, BOB.id, "admin", { now: NOW });
    await providers.projects.setMemberRole(TEAM, ANN.id, "user", { now: NOW });
    expect((await send("DELETE", `/api-tokens/${token.id}`, await as(ANN))).statusCode).toBe(404);
  });
});

describe("revokeLegacyAccessKey", () => {
  it("answers 409 while LEGACY_KEY_REVOKE is off, and the key keeps working", async () => {
    const { as, send } = await start();
    const res = await send("DELETE", "/api-tokens/legacy-key", await as(ANN));
    // Routed to revokeLegacyAccessKey, not to revokeApiToken with the id `legacy-key`.
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "legacy-key-revoke-unavailable" });
    expect((await send("GET", "/surveys", bearer(ANN_KEY))).statusCode).toBe(200);
  });

  it("revokes the key when on: it stops, the list drops it, and a repeat is 404", async () => {
    const { as, send } = await start({ env: { LEGACY_KEY_REVOKE: "true" } });
    const ann = await as(ANN);
    expect((await send("DELETE", "/api-tokens/legacy-key", ann)).statusCode).toBe(204);
    expect((await send("GET", "/surveys", bearer(ANN_KEY))).statusCode).toBe(401);
    expect((await send("GET", "/api-tokens", ann)).json()).toMatchObject({ legacyKey: null });
    const again = await send("DELETE", "/api-tokens/legacy-key", ann);
    expect(again.statusCode).toBe(404);
    expect(again.json()).toMatchObject({ code: "not-found" });
  });

  it("answers 404 to a user without a key", async () => {
    const { as, send } = await start({ env: { LEGACY_KEY_REVOKE: "true" } });
    expect((await send("DELETE", "/api-tokens/legacy-key", await as(BOB))).statusCode).toBe(404);
  });

  it("refuses the key itself", async () => {
    const { send } = await start({ env: { LEGACY_KEY_REVOKE: "true" } });
    expect((await send("DELETE", "/api-tokens/legacy-key", bearer(ANN_KEY))).statusCode).toBe(401);
    expect((await send("GET", "/surveys", bearer(ANN_KEY))).statusCode).toBe(200);
  });
});

describe("replaceCurrentCredential", () => {
  it("rotates the token of the request: same id, name and scope, a new value", async () => {
    const { as, send, create } = await start();
    const { token, value } = await create(ANN, TEAM, "Deploy");
    const res = await send("POST", "/me/credential", bearer(value));
    expect(res.statusCode).toBe(200);
    const next = res.json<{ value: string }>().value;
    expect(next).toMatch(/^sjs_[A-Za-z0-9_-]{43}$/);
    expect((await send("GET", "/surveys", bearer(value))).statusCode).toBe(401);
    expect((await send("GET", "/surveys", bearer(next))).statusCode).toBe(200);
    const listed = await send("GET", `/api-tokens?project=${TEAM}`, await as(ANN));
    expect(listed.json()).toMatchObject({
      tokens: [{ id: token.id, name: "Deploy", projectId: TEAM, lastFour: next.slice(-4) }],
    });
  });

  it("answers 409 to a legacy key, which keeps working", async () => {
    const { send } = await start();
    const res = await send("POST", "/me/credential", bearer(ANN_KEY));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "legacy-key-replace-unavailable" });
    expect((await send("GET", "/surveys", bearer(ANN_KEY))).statusCode).toBe(200);
  });

  it("answers 401 to a session", async () => {
    const { as, send } = await start();
    expect((await send("POST", "/me/credential", await as(ANN))).statusCode).toBe(401);
  });

  it("answers 401 when the token is revoked between authentication and the replace", async () => {
    // The revoke lands after the bearer check passed (Review Focus 5).
    let revokeFirst: ((id: string) => Promise<unknown>) | null = null;
    const wrap = (providers: ProviderSet): ProviderSet => {
      const credentials: CredentialStore = {
        ...providers.credentials,
        replaceApiTokenHash: async (id, hash, lastFour) => {
          await revokeFirst?.(id);
          return providers.credentials.replaceApiTokenHash(id, hash, lastFour);
        },
      };
      revokeFirst = (id) => providers.credentials.revokeApiToken(id, NOW);
      return { ...providers, credentials };
    };
    const { send, create } = await start({ wrap });
    const { value } = await create(ANN, null);
    const res = await send("POST", "/me/credential", bearer(value));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "unauthenticated" });
    expect((await send("GET", "/surveys", bearer(value))).statusCode).toBe(401);
  });
});
