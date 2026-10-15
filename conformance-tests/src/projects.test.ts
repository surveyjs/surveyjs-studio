/**
 * `listProjects` and `getProject` against the legacy fixtures. Step 4 creates no projects, so the
 * lists are exact.
 */
import { describe, expect, it, type TestContext } from "vitest";
import { call, codeOf, sessionHeaders, signedIn } from "./harness.js";
import { fixtureUsers, type SignInResult } from "./sign-in.js";

const { owner, admin, member, outsider } = fixtureUsers;

const MARKETING = "55555555-0000-4000-8000-a00000000001";
const ENGINEERING = "55555555-0000-4000-8000-a00000000002";
const UNKNOWN_ID = "99999999-0000-4000-8000-a00000000099";

interface Project {
  id: string;
  name: string;
  ownerId: string;
  role: string;
  memberCount: number;
  createdAt: string;
}

interface ProjectPage {
  items: Project[];
  nextCursor: string | null;
}

const engineering = (role: string): Project => ({
  id: ENGINEERING,
  name: "Engineering",
  ownerId: admin.id,
  role,
  memberCount: 2,
  createdAt: "2025-12-01T09:00:00.000Z",
});

const marketing = (role: string): Project => ({
  id: MARKETING,
  name: "Marketing",
  ownerId: owner.id,
  role,
  memberCount: 3,
  createdAt: "2025-11-21T10:00:00.000Z",
});

const sessions = new Map<string, SignInResult>();

/** Request headers of the user's browser; signs in once per user and test file. */
async function as(ctx: TestContext, user: { id: string }): Promise<Record<string, string>> {
  let session = sessions.get(user.id);
  if (!session) {
    session = await signedIn(ctx, user.id);
    expect(session.callback.status).toBe(302);
    sessions.set(user.id, session);
  }
  return sessionHeaders(session);
}

function list(headers: Record<string, string>, query = ""): Promise<Response> {
  return call("GET", "/projects", { path: `/projects${query}`, headers });
}

async function page(headers: Record<string, string>, query = ""): Promise<ProjectPage> {
  const response = await list(headers, query);
  expect(response.status).toBe(200);
  return (await response.json()) as ProjectPage;
}

describe("listProjects", () => {
  it("answers 401 unauthenticated when signed out", async () => {
    expect((await list({})).status).toBe(401);
  });

  it("lists the owner's projects by name with the owner's role in each", async (ctx) => {
    expect(await page(await as(ctx, owner))).toEqual({
      items: [engineering("user"), marketing("admin")],
      nextCursor: null,
    });
  });

  it("lists both projects as admin to the admin", async (ctx) => {
    expect(await page(await as(ctx, admin))).toEqual({
      items: [engineering("admin"), marketing("admin")],
      nextCursor: null,
    });
  });

  it("lists only Marketing to the member", async (ctx) => {
    expect(await page(await as(ctx, member))).toEqual({
      items: [marketing("user")],
      nextCursor: null,
    });
  });

  it("lists nothing for a user without projects", async (ctx) => {
    expect(await page(await as(ctx, outsider))).toEqual({ items: [], nextCursor: null });
  });

  it("pages with limit and cursor in list order", async (ctx) => {
    const headers = await as(ctx, owner);
    const first = await page(headers, "?limit=1");
    expect(first.items).toEqual([engineering("user")]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await page(headers, `?limit=1&cursor=${String(first.nextCursor)}`);
    expect(second).toEqual({ items: [marketing("admin")], nextCursor: null });
  });

  it("answers 400 bad-request for an invalid cursor, a survey cursor or a limit of 0", async (ctx) => {
    const headers = await as(ctx, owner);
    const surveys = await call("GET", "/surveys", { path: "/surveys?limit=1", headers });
    const { nextCursor } = (await surveys.json()) as { nextCursor: string | null };
    expect(nextCursor).toEqual(expect.any(String));
    for (const query of ["?cursor=abc", `?cursor=${String(nextCursor)}`, "?limit=0"]) {
      const response = await list(headers, query);
      expect(response.status, query).toBe(400);
      expect(await codeOf(response)).toBe("bad-request");
    }
  });
});

describe("getProject", () => {
  function get(headers: Record<string, string>, id: string): Promise<Response> {
    return call("GET", "/projects/{projectId}", { path: `/projects/${id}`, headers });
  }

  it("answers a project to its member", async (ctx) => {
    const response = await get(await as(ctx, member), MARKETING);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(marketing("user"));
  });

  it("answers 404 not-found for a project of others and for an unknown id", async (ctx) => {
    const headers = await as(ctx, member);
    for (const id of [ENGINEERING, UNKNOWN_ID]) {
      const response = await get(headers, id);
      expect(response.status, id).toBe(404);
      expect(await codeOf(response)).toBe("not-found");
    }
  });

  it("answers 400 bad-request for an id longer than 64 characters", async (ctx) => {
    const response = await get(await as(ctx, owner), "x".repeat(65));
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("bad-request");
  });

  it("answers 401 unauthenticated when signed out", async () => {
    expect((await get({}, MARKETING)).status).toBe(401);
  });
});
