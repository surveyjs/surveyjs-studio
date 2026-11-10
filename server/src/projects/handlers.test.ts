/**
 * The project and member operations over HTTP on a memory store: the check order, the owner and the
 * receiver of a deleted project's surveys, orphan rows and the members cursor. Each test starts a
 * fresh app on the seed below, so tests may write anything.
 */
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createDevIdentityProvider } from "../auth/providers/dev.js";
import { signIn } from "../auth/testing.js";
import { loadConfig } from "../config.js";
import type { SurveyRecord, User } from "../domain/types.js";
import { encodeProjectCursor } from "../paging/cursor.js";
import { createMemoryProviders, type MemorySeed } from "../providers/memory.js";
import type { ProviderSet } from "../providers/types.js";

const NOW = "2026-09-01T12:00:00.000Z";

const user = (n: number, displayName: string): User => ({
  id: `aaaaaaaa-0000-4000-8000-00000000000${n}`,
  email: `${displayName.split(" ")[0]?.toLowerCase() ?? ""}@example.test`,
  displayName,
  blocked: false,
});

const ANN = user(1, "Ann Admin");
const BOB = user(2, "bob");
const CARA = user(3, "Cara");
const DAN = user(4, "Dan");
/** A name in U+E000–U+FFFF: after any surrogate pair (U+10000 and up) in UTF-16 order. */
const EVE = { ...user(5, "Eve"), displayName: "\uFFFD Eve" };
/** A membership row whose user does not exist. */
const ORPHAN_ID = "aaaaaaaa-0000-4000-8000-000000000009";

const TEAM = "bbbbbbbb-0000-4000-8000-000000000001";
const GONE = "bbbbbbbb-0000-4000-8000-000000000002";

function survey(n: number, creatorId: string, archived: boolean): SurveyRecord {
  return {
    id: `cccccccc-0000-4000-8000-00000000000${n}`,
    name: `Survey ${n}`,
    owner: { kind: "project", projectId: GONE },
    creatorId,
    postId: `dddddddd-0000-4000-8000-00000000000${n}`,
    resultId: `eeeeeeee-0000-4000-8000-00000000000${n}`,
    published: false,
    archived,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
  };
}

const S1 = survey(1, CARA.id, false);
const S2 = survey(2, ANN.id, true);

const seed: MemorySeed = {
  users: [ANN, BOB, CARA, DAN, EVE],
  surveys: [S1, S2],
  projects: [
    { id: TEAM, name: "Team", creatorId: ANN.id, createdAt: "2025-01-01T00:00:00.000Z" },
    // Its creator is not a member: the project has no owner.
    { id: GONE, name: "Gone", creatorId: DAN.id, createdAt: "2025-02-01T00:00:00.000Z" },
  ],
  memberships: [
    { userId: ANN.id, projectId: TEAM, role: "admin" },
    { userId: BOB.id, projectId: TEAM, role: "user" },
    { userId: CARA.id, projectId: TEAM, role: "user" },
    { userId: ORPHAN_ID, projectId: TEAM, role: "admin" },
    { userId: ANN.id, projectId: GONE, role: "admin" },
  ],
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

type Headers = Record<string, string>;

/** The app on a memory store with the seed above, its clock fixed at NOW. */
async function start(userDirectory: "external" | "local" = "external"): Promise<{
  providers: ProviderSet;
  as: (user: User) => Promise<Headers>;
}> {
  const config = loadConfig({ NODE_ENV: "test", IDENTITY_PROVIDER: "dev" });
  const providers = createMemoryProviders(seed, { userDirectory });
  const server = await buildApp(config, providers, {
    identity: createDevIdentityProvider({ publicBaseUrl: config.publicBaseUrl, users: seed.users }),
    now: () => Date.parse(NOW),
  });
  app = server;
  const sessions = new Map<string, Headers>();
  return {
    providers,
    as: async (u) => {
      let headers = sessions.get(u.id);
      if (!headers) {
        headers = { ...(await signIn(server, u.id)).headers };
        sessions.set(u.id, headers);
      }
      return headers;
    },
  };
}

function send(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  headers: Headers,
  payload?: object,
) {
  if (!app) throw new Error("start() first");
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers,
    ...(payload && { payload }),
  });
}

const member = (u: User, role: "admin" | "user") => ({
  userId: u.id,
  displayName: u.displayName,
  email: u.email,
  role,
  status: "active",
});

describe("getProject", () => {
  it("counts every membership row and names the creator while a member as the owner", async () => {
    const { as } = await start();
    const ann = await as(ANN);
    const team = await send("GET", `/projects/${TEAM}`, ann);
    expect(team.statusCode).toBe(200);
    expect(team.json()).toMatchObject({ memberCount: 4, ownerId: ANN.id, role: "admin" });
    const gone = await send("GET", `/projects/${GONE}`, ann);
    expect(gone.statusCode).toBe(200);
    expect(gone.json()).toMatchObject({ ownerId: null });
  });
});

describe("listMembers", () => {
  it("lists the members whose user exists, by display name ignoring case", async () => {
    const { as } = await start();
    const res = await send("GET", `/projects/${TEAM}/members`, await as(ANN));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({
      items: [member(ANN, "admin"), member(BOB, "user"), member(CARA, "user")],
      nextCursor: null,
    });
  });

  it("pages with a cursor bound to the project", async () => {
    const { as } = await start();
    const ann = await as(ANN);
    const first = await send("GET", `/projects/${TEAM}/members?limit=2`, ann);
    expect(first.statusCode).toBe(200);
    const page = first.json<{ items: unknown[]; nextCursor: string | null }>();
    expect(page.items).toStrictEqual([member(ANN, "admin"), member(BOB, "user")]);
    expect(page.nextCursor).toEqual(expect.any(String));
    const cursor = String(page.nextCursor);

    const second = await send("GET", `/projects/${TEAM}/members?limit=2&cursor=${cursor}`, ann);
    expect(second.json()).toStrictEqual({ items: [member(CARA, "user")], nextCursor: null });

    const projectCursor = encodeProjectCursor({ name: "team", id: TEAM });
    for (const url of [
      `/projects/${GONE}/members?cursor=${cursor}`,
      `/projects/${TEAM}/members?cursor=${projectCursor}`,
    ]) {
      const res = await send("GET", url, ann);
      expect(res.statusCode, url).toBe(400);
      expect(res.json()).toMatchObject({ code: "bad-request", detail: "Invalid cursor." });
    }
  });

  it("answers 404 not-found to a user who is not a member", async () => {
    const { as } = await start();
    const res = await send("GET", `/projects/${TEAM}/members`, await as(DAN));
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "not-found" });
  });
});

describe("orphan rows", () => {
  it("are not members: a role change or removal of one answers 404 not-found", async () => {
    const { as } = await start();
    const ann = await as(ANN);
    const changed = await send("PATCH", `/projects/${TEAM}/members/${ORPHAN_ID}`, ann, {
      role: "user",
    });
    expect(changed.statusCode).toBe(404);
    expect(changed.json()).toMatchObject({ code: "not-found" });
    const removed = await send("DELETE", `/projects/${TEAM}/members/${ORPHAN_ID}`, ann);
    expect(removed.statusCode).toBe(404);
    expect(removed.json()).toMatchObject({ code: "not-found" });
  });

  it("do not count as admins: the last admin cannot step down", async () => {
    const { as } = await start();
    const res = await send("PATCH", `/projects/${TEAM}/members/${ANN.id}`, await as(ANN), {
      role: "user",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toStrictEqual({
      type: "https://studio.surveyjs.io/problems/last-admin",
      code: "last-admin",
      status: 409,
      title: "Last admin",
      detail: "A project must keep at least one admin.",
    });
  });
});

describe("deleteProject", () => {
  it("moves the surveys of a project without an owner to the deleting admin", async () => {
    const { as, providers } = await start();
    const ann = await as(ANN);
    const res = await send("DELETE", `/projects/${GONE}`, ann);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");

    const active = await send("GET", "/surveys?project=personal", ann);
    const archived = await send("GET", "/surveys?project=personal&archived=true", ann);
    expect(active.json()).toMatchObject({
      items: [{ id: S1.id, projectId: null, updatedAt: NOW }],
    });
    expect(archived.json()).toMatchObject({
      items: [{ id: S2.id, projectId: null, updatedAt: NOW, archived: true }],
    });
    expect((await providers.surveys.getSurvey(S1.id))?.creatorId).toBe(CARA.id);
    expect((await send("GET", `/projects/${GONE}`, ann)).statusCode).toBe(404);
  });
});

describe("createProject", () => {
  it("stores the name as sent and makes the creator its admin and owner", async () => {
    const { as } = await start();
    const dan = await as(DAN);
    const res = await send("POST", "/projects", dan, { name: " Spaced " });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string }>();
    expect(res.headers.location).toBe(`/api/v1/projects/${body.id}`);
    expect(body).toStrictEqual({
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      name: " Spaced ",
      ownerId: DAN.id,
      role: "admin",
      memberCount: 1,
      createdAt: NOW,
    });

    const leave = await send("DELETE", `/projects/${body.id}/members/${DAN.id}`, dan);
    expect(leave.statusCode).toBe(409);
    expect(leave.json()).toMatchObject({ code: "last-admin" });
  });

  it("answers 422 for a blank name", async () => {
    const { as } = await start();
    const res = await send("POST", "/projects", await as(DAN), { name: "   " });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toStrictEqual({
      type: "https://studio.surveyjs.io/problems/validation-failed",
      code: "validation-failed",
      status: 422,
      title: "Validation failed",
      errors: [{ pointer: "/name", detail: "must not be blank" }],
    });
  });
});

describe("check order", () => {
  it("refuses a plain member with 403 and a non-member with 404, after the name check", async () => {
    const { as } = await start();
    const bob = await as(BOB);
    const dan = await as(DAN);

    const byMember = await send("PATCH", `/projects/${TEAM}`, bob, { name: "Mine" });
    expect(byMember.statusCode).toBe(403);
    expect(byMember.json()).toStrictEqual({
      type: "https://studio.surveyjs.io/problems/forbidden",
      code: "forbidden",
      status: 403,
      title: "Forbidden",
      detail: "Only project admins can do this.",
    });
    expect((await send("PATCH", `/projects/${TEAM}`, dan, { name: "Mine" })).statusCode).toBe(404);
    const blank = await send("PATCH", `/projects/${TEAM}`, dan, { name: "  " });
    expect(blank.statusCode).toBe(422);
    expect(blank.json()).toMatchObject({ errors: [{ pointer: "/name" }] });
  });

  it("checks the caller is an admin before looking up the email", async () => {
    const { as } = await start();
    const res = await send("POST", `/projects/${TEAM}/members`, await as(BOB), {
      email: "nobody@example.test",
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "forbidden" });
  });

  it("lets a plain member leave but not remove someone else", async () => {
    const { as } = await start();
    const bob = await as(BOB);
    const other = await send("DELETE", `/projects/${TEAM}/members/${CARA.id}`, bob);
    expect(other.statusCode).toBe(403);
    expect(other.json()).toMatchObject({ code: "forbidden" });
    const leave = await send("DELETE", `/projects/${TEAM}/members/${BOB.id}`, bob);
    expect(leave.statusCode).toBe(204);
    expect((await send("GET", `/projects/${TEAM}`, bob)).statusCode).toBe(404);
  });
});

describe("pending members", () => {
  const pending = (email: string, role: "admin" | "user" = "user") => ({
    userId: null,
    displayName: email,
    email,
    role,
    status: "pending",
  });

  it("adds an email no account has as an invitation, with its own Location", async () => {
    const { as } = await start("local");
    const res = await send("POST", `/projects/${TEAM}/members`, await as(ANN), {
      email: "New.Person@example.test",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toStrictEqual(pending("new.person@example.test"));
    expect(res.headers.location).toBe(
      `/api/v1/projects/${TEAM}/invitations/new.person@example.test`,
    );
  });

  it("still makes a member of an email that has an account", async () => {
    const { as } = await start("local");
    const res = await send("POST", `/projects/${TEAM}/members`, await as(ANN), {
      email: DAN.email,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toStrictEqual(member(DAN, "user"));
  });

  it("answers 409 already-invited whatever the letter case", async () => {
    const { as } = await start("local");
    const ann = await as(ANN);
    const first = await send("POST", `/projects/${TEAM}/members`, ann, {
      email: "Alice@Example.com",
    });
    expect(first.statusCode).toBe(201);
    const again = await send("POST", `/projects/${TEAM}/members`, ann, {
      email: "alice@example.com",
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: "already-invited" });
  });

  it("keeps 404 user-not-found without local accounts", async () => {
    const { as } = await start("external");
    const res = await send("POST", `/projects/${TEAM}/members`, await as(ANN), {
      email: "nobody@example.test",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "user-not-found" });
  });

  it("lists the invitations after the members, by email", async () => {
    const { as } = await start("local");
    const ann = await as(ANN);
    for (const email of ["zed@example.test", "amy@example.test"]) {
      await send("POST", `/projects/${TEAM}/members`, ann, { email });
    }
    const res = await send("GET", `/projects/${TEAM}/members`, ann);
    expect(res.json()).toStrictEqual({
      items: [
        member(ANN, "admin"),
        member(BOB, "user"),
        member(CARA, "user"),
        pending("amy@example.test"),
        pending("zed@example.test"),
      ],
      nextCursor: null,
    });
    const first = await send("GET", `/projects/${TEAM}/members?limit=3`, ann);
    const cursor = String(first.json<{ nextCursor: string }>().nextCursor);
    const second = await send("GET", `/projects/${TEAM}/members?limit=3&cursor=${cursor}`, ann);
    const items = second.json<{ items: unknown[]; nextCursor: string | null }>();
    expect(items.items).toStrictEqual([pending("amy@example.test"), pending("zed@example.test")]);
    expect(items.nextCursor).toBeNull();
  });

  it("pages across the members and the invitations with any member name", async () => {
    const { as } = await start("local");
    const ann = await as(ANN);
    await send("POST", `/projects/${TEAM}/members`, ann, { email: EVE.email });
    for (const email of ["zed@example.test", "amy@example.test"]) {
      await send("POST", `/projects/${TEAM}/members`, ann, { email });
    }
    const whole = [
      member(ANN, "admin"),
      member(BOB, "user"),
      member(CARA, "user"),
      member(EVE, "user"),
      pending("amy@example.test"),
      pending("zed@example.test"),
    ];
    expect((await send("GET", `/projects/${TEAM}/members`, ann)).json()).toStrictEqual({
      items: whole,
      nextCursor: null,
    });
    // Every page size puts a page boundary at Eve's row, or at an invitation's.
    for (let limit = 1; limit <= whole.length; limit++) {
      const walked: unknown[] = [];
      let cursor: string | null = null;
      do {
        const query: string = cursor === null ? "" : `&cursor=${cursor}`;
        const page = await send("GET", `/projects/${TEAM}/members?limit=${limit}${query}`, ann);
        expect(page.statusCode).toBe(200);
        const body = page.json<{ items: unknown[]; nextCursor: string | null }>();
        walked.push(...body.items);
        cursor = body.nextCursor;
      } while (cursor !== null && walked.length <= whole.length);
      expect(walked, `limit=${limit}`).toStrictEqual(whole);
    }
  });

  it("removes an invitation, once, for admins only", async () => {
    const { as } = await start("local");
    const ann = await as(ANN);
    await send("POST", `/projects/${TEAM}/members`, ann, { email: "amy@example.test" });
    const url = `/projects/${TEAM}/invitations/AMY@example.test`;
    const denied = await send("DELETE", url, await as(BOB));
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "forbidden" });
    expect((await send("DELETE", url, ann)).statusCode).toBe(204);
    const again = await send("DELETE", url, ann);
    expect(again.statusCode).toBe(404);
    expect(again.json()).toMatchObject({ code: "not-found" });
    expect(
      (await send("DELETE", `/projects/${GONE}/invitations/x@example.test`, ann)).statusCode,
    ).toBe(404);
  });

  it("round-trips the Location of an email with reserved characters", async () => {
    const { as } = await start("local");
    const ann = await as(ANN);
    const email = "a#b+c%41?d@example.test";
    const res = await send("POST", `/projects/${TEAM}/members`, ann, { email });
    expect(res.statusCode).toBe(201);
    const location = String(res.headers.location);
    expect(location).toBe(`/api/v1/projects/${TEAM}/invitations/a%23b%2Bc%2541%3Fd@example.test`);
    const removed = await send("DELETE", location.slice("/api/v1".length), ann);
    expect(removed.statusCode).toBe(204);
    const list = await send("GET", `/projects/${TEAM}/members`, ann);
    expect(list.json<{ items: { email: string }[] }>().items.map((m) => m.email)).not.toContain(
      email,
    );
  });

  it("answers 404 without local accounts", async () => {
    const { as } = await start("external");
    const res = await send(
      "DELETE",
      `/projects/${TEAM}/invitations/amy@example.test`,
      await as(ANN),
    );
    expect(res.statusCode).toBe(404);
  });
});
