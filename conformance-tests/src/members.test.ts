/**
 * `listMembers`, `addMember`, `updateMember` and `removeMember` against the legacy fixtures.
 *
 * Data rules: the data is shared by all test files and never reset (the Azurite replica keeps it
 * between runs). Marketing, Engineering and every fixture membership are read only: the lists of
 * their members are read, and the refusals on them write nothing. Every write goes to a project the
 * test creates as Adam Admin, with a unique name (`Conformance <purpose> <random>`), and deletes at
 * the end. Only Mia Member and the blocked user are ever added to such a project; never Olivia
 * Owner or Oscar Outsider (their ids are only used as targets that are not members). Cleanup is
 * registered with `onTestFinished` right after the project is created, so it also runs when a test
 * fails; it deletes the project as Adam, or as Mia when Adam is no longer an admin.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, inject, it, onTestFinished, type TestContext } from "vitest";
import { call, codeOf, as, listPage, sandbox, walkPages } from "./harness.js";
import { fixtureUsers } from "./sign-in.js";

const { owner, admin, member, outsider, blocked } = fixtureUsers;

const MARKETING = "55555555-0000-4000-8000-a00000000001";
const ENGINEERING = "55555555-0000-4000-8000-a00000000002";
const UNKNOWN_ID = "99999999-0000-4000-8000-a00000000099";
const BLOCKED_EMAIL = "blocked@example.com";
const MERGE_PATCH = "application/merge-patch+json";

const MEMBERS = "/projects/{projectId}/members";
const MEMBER = "/projects/{projectId}/members/{userId}";

type Headers = Record<string, string>;

interface Member {
  userId: string | null;
  displayName: string;
  email: string;
  role: string;
  status?: string;
}

interface MemberPage {
  items: Member[];
  nextCursor: string | null;
}

/** The same browser without the CSRF token header. */
const withoutCsrf = (headers: Headers): Headers => ({ cookie: headers.cookie ?? "" });

const memberOf = (
  user: { id: string; displayName: string; email: string },
  role: string,
): Member => ({
  userId: user.id,
  displayName: user.displayName,
  email: user.email,
  role,
  status: "active",
});

/**
 * Local accounts (CONFORMANCE_AUTH=password): unknown emails become invitations (Step 8, D4). The
 * sandbox is a local directory too (self-hosted Step 9, D6), with the seed's invitation.
 */
const localAccounts = inject("passwordAdmin") !== null || sandbox;

const pendingOf = (email: string, role = "user"): Member => ({
  userId: null,
  displayName: email,
  email,
  role,
  status: "pending",
});

/** The shared seed's invitation to Marketing; only local-directory instances have it. */
const seededPending = localAccounts ? [pendingOf("invited@example.com")] : [];

/** A project of Adam's with a unique name; deleted at the end as Adam, else as Mia. */
async function ownProject(ctx: TestContext, purpose: string): Promise<string> {
  const adam = await as(ctx, admin);
  const response = await call("POST", "/projects", {
    headers: adam,
    body: { name: `Conformance ${purpose} ${randomUUID().slice(0, 8)}` },
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const candidates = [adam, await as(ctx, member)];
  onTestFinished(async () => {
    const statuses: number[] = [];
    for (const headers of candidates) {
      const deleted = await call("DELETE", "/projects/{projectId}", {
        path: `/projects/${id}`,
        headers,
      });
      if (deleted.status === 204) return;
      statuses.push(deleted.status);
    }
    // A project nobody could delete would stay on the shared data.
    expect.fail(`project ${id} was not cleaned up (answers ${statuses.join(", ")})`);
  });
  return id;
}

function list(headers: Headers, projectId: string, query = ""): Promise<Response> {
  return call("GET", MEMBERS, { path: `/projects/${projectId}/members${query}`, headers });
}

const page = (headers: Headers, projectId: string, query = ""): Promise<MemberPage> =>
  listPage<Member>(MEMBERS, `/projects/${projectId}/members${query}`, headers);

function add(headers: Headers, projectId: string, body: unknown): Promise<Response> {
  return call("POST", MEMBERS, { path: `/projects/${projectId}/members`, headers, body });
}

async function added(headers: Headers, projectId: string, body: unknown): Promise<Member> {
  const response = await add(headers, projectId, body);
  expect(response.status).toBe(201);
  return (await response.json()) as Member;
}

function change(headers: Headers, projectId: string, userId: string, body: unknown) {
  return call("PATCH", MEMBER, {
    path: `/projects/${projectId}/members/${userId}`,
    headers: { "content-type": MERGE_PATCH, ...headers },
    body,
  });
}

function removeMember(headers: Headers, projectId: string, userId: string) {
  return call("DELETE", MEMBER, { path: `/projects/${projectId}/members/${userId}`, headers });
}

async function expectProblem(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(await codeOf(response)).toBe(code);
}

describe("listMembers", () => {
  it("lists Marketing's members by display name to a plain member", async (ctx) => {
    expect(await page(await as(ctx, member), MARKETING)).toEqual({
      items: [
        memberOf(admin, "admin"),
        memberOf(member, "user"),
        memberOf(owner, "admin"),
        ...seededPending,
      ],
      nextCursor: null,
    });
  });

  it("lists Engineering's members", async (ctx) => {
    expect(await page(await as(ctx, owner), ENGINEERING)).toEqual({
      items: [memberOf(admin, "admin"), memberOf(owner, "user")],
      nextCursor: null,
    });
  });

  it("pages with a cursor that belongs to the project", async (ctx) => {
    const olivia = await as(ctx, owner);
    const pages = await walkPages<Member>(
      MEMBERS,
      `/projects/${MARKETING}/members?limit=1`,
      olivia,
    );
    expect(pages.map((p) => p.items.length)).toEqual(localAccounts ? [1, 1, 1, 1] : [1, 1, 1]);
    expect(pages.flatMap((p) => p.items)).toEqual([
      memberOf(admin, "admin"),
      memberOf(member, "user"),
      memberOf(owner, "admin"),
      ...seededPending,
    ]);

    const first = String(pages[0]?.nextCursor);
    for (const [projectId, query] of [
      [ENGINEERING, `?cursor=${first}`],
      [MARKETING, "?cursor=x"],
      [MARKETING, "?limit=0"],
    ] as const) {
      await expectProblem(await list(olivia, projectId, query), 400, "bad-request");
    }
  });

  it("answers 404 to a non-member and for an unknown project, 401 signed out", async (ctx) => {
    await expectProblem(await list(await as(ctx, outsider), MARKETING), 404, "not-found");
    await expectProblem(await list(await as(ctx, owner), UNKNOWN_ID), 404, "not-found");
    await expectProblem(await list({}, MARKETING), 401, "unauthenticated");
  });
});

describe("addMember", () => {
  it("adds a registered user by email, in any case, as user by default", async (ctx) => {
    if (sandbox) ctx.skip("needs the blocked user a05, whom the sandbox seed leaves out");
    const adam = await as(ctx, admin);
    const projectId = await ownProject(ctx, "add");

    const response = await add(adam, projectId, { email: "MEMBER@Example.COM" });
    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe(
      `/api/v1/projects/${projectId}/members/${member.id}`,
    );
    expect(await response.json()).toEqual(memberOf(member, "user"));

    await expectProblem(await add(adam, projectId, { email: member.email }), 409, "already-member");
    if (!localAccounts) {
      await expectProblem(
        await add(adam, projectId, { email: `nobody-${randomUUID()}@example.com` }),
        404,
        "user-not-found",
      );
    }
    for (const body of [{ email: "not-an-email" }, { email: owner.email, role: "owner" }]) {
      await expectProblem(await add(adam, projectId, body), 422, "validation-failed");
    }

    // Blocked users may be added (R12).
    expect(await added(adam, projectId, { email: BLOCKED_EMAIL, role: "admin" })).toEqual({
      userId: blocked.id,
      displayName: BLOCKED_EMAIL,
      email: BLOCKED_EMAIL,
      role: "admin",
      status: "active",
    });
    const project = await call("GET", "/projects/{projectId}", {
      path: `/projects/${projectId}`,
      headers: adam,
    });
    expect(await project.json()).toMatchObject({ memberCount: 3 });
  });

  it.runIf(localAccounts)("invites an unknown email, lists it and removes it", async (ctx) => {
    const adam = await as(ctx, admin);
    const projectId = await ownProject(ctx, "invite");
    const email = `new-${randomUUID().slice(0, 8)}@example.com`;

    const response = await add(adam, projectId, { email: email.toUpperCase(), role: "admin" });
    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe(
      `/api/v1/projects/${projectId}/invitations/${email}`,
    );
    expect(await response.json()).toEqual(pendingOf(email, "admin"));
    await expectProblem(await add(adam, projectId, { email }), 409, "already-invited");

    expect((await page(adam, projectId)).items).toEqual([
      memberOf(admin, "admin"),
      pendingOf(email, "admin"),
    ]);

    const url = `/projects/${projectId}/invitations/${email}`;
    const remove = (headers: Headers) =>
      call("DELETE", "/projects/{projectId}/invitations/{email}", { path: url, headers });
    // The sandbox has no CSRF token (D3 of self-hosted Step 9): its session is the msid cookie alone.
    if (!sandbox) {
      await expectProblem(await remove(withoutCsrf(adam)), 403, "csrf-token-invalid");
    }
    expect((await remove(adam)).status).toBe(204);
    await expectProblem(await remove(adam), 404, "not-found");
    expect((await page(adam, projectId)).items).toEqual([memberOf(admin, "admin")]);
  });

  it.runIf(!localAccounts)("answers 404 user-not-found for an unknown email", async (ctx) => {
    const projectId = await ownProject(ctx, "unknown email");
    await expectProblem(
      await add(await as(ctx, admin), projectId, { email: `nobody-${randomUUID()}@example.com` }),
      404,
      "user-not-found",
    );
  });

  it("refuses a plain member with 403, a non-member with 404 and no CSRF token with 403", async (ctx) => {
    const adam = await as(ctx, admin);
    const projectId = await ownProject(ctx, "add refusals");
    await added(adam, projectId, { email: member.email });

    await expectProblem(
      await add(await as(ctx, member), projectId, { email: owner.email }),
      403,
      "forbidden",
    );
    await expectProblem(
      await add(await as(ctx, outsider), projectId, { email: owner.email }),
      404,
      "not-found",
    );
    // The sandbox has no CSRF token (D3 of self-hosted Step 9): its session is the msid cookie alone.
    if (!sandbox) {
      await expectProblem(
        await add(withoutCsrf(adam), projectId, { email: owner.email }),
        403,
        "csrf-token-invalid",
      );
    }
    expect((await page(adam, projectId)).items.map((m) => m.userId)).toEqual([admin.id, member.id]);
  });
});

describe("updateMember", () => {
  it("promotes and demotes, keeps one admin, and refuses others", async (ctx) => {
    const adam = await as(ctx, admin);
    const mia = await as(ctx, member);
    const projectId = await ownProject(ctx, "role");
    await added(adam, projectId, { email: member.email });

    const promoted = await change(adam, projectId, member.id, { role: "admin" });
    expect(promoted.status).toBe(200);
    expect(await promoted.json()).toEqual(memberOf(member, "admin"));
    const again = await change(adam, projectId, member.id, { role: "admin" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(memberOf(member, "admin"));

    const selfDemoted = await change(adam, projectId, admin.id, { role: "user" });
    expect(selfDemoted.status).toBe(200);
    expect(await selfDemoted.json()).toEqual(memberOf(admin, "user"));
    await expectProblem(
      await change(mia, projectId, member.id, { role: "user" }),
      409,
      "last-admin",
    );

    for (const userId of [outsider.id, UNKNOWN_ID]) {
      await expectProblem(await change(mia, projectId, userId, { role: "user" }), 404, "not-found");
    }
    await expectProblem(
      await change(adam, projectId, member.id, { role: "user" }),
      403,
      "forbidden",
    );
    await expectProblem(
      await change(await as(ctx, outsider), projectId, member.id, { role: "user" }),
      404,
      "not-found",
    );
    for (const body of [{}, { role: "owner" }]) {
      await expectProblem(await change(mia, projectId, admin.id, body), 422, "validation-failed");
    }
    await expectProblem(
      await change(mia, projectId, "x".repeat(65), { role: "user" }),
      400,
      "bad-request",
    );
    expect((await page(adam, projectId)).items).toEqual([
      memberOf(admin, "user"),
      memberOf(member, "admin"),
    ]);
  });
});

describe("removeMember", () => {
  it("lets admins remove others and members leave, keeping one admin", async (ctx) => {
    const adam = await as(ctx, admin);
    const mia = await as(ctx, member);
    const projectId = await ownProject(ctx, "remove");
    await added(adam, projectId, { email: member.email });

    expect((await removeMember(adam, projectId, member.id)).status).toBe(204);
    expect((await page(adam, projectId)).items).toEqual([memberOf(admin, "admin")]);

    await added(adam, projectId, { email: member.email });
    await expectProblem(await removeMember(mia, projectId, admin.id), 403, "forbidden");
    expect((await removeMember(mia, projectId, member.id)).status).toBe(204);
    const gone = await call("GET", "/projects/{projectId}", {
      path: `/projects/${projectId}`,
      headers: mia,
    });
    expect(gone.status).toBe(404);

    await added(adam, projectId, { email: member.email });
    await expectProblem(await removeMember(adam, projectId, admin.id), 409, "last-admin");
    expect((await removeMember(adam, projectId, member.id)).status).toBe(204);
    // The only member cannot leave either; they delete the project instead.
    await expectProblem(await removeMember(adam, projectId, admin.id), 409, "last-admin");
  });

  it("answers 404 for a target or caller who is not a member, 403 without the CSRF token", async (ctx) => {
    const adam = await as(ctx, admin);
    const projectId = await ownProject(ctx, "remove refusals");
    await added(adam, projectId, { email: member.email });

    await expectProblem(await removeMember(adam, projectId, outsider.id), 404, "not-found");
    await expectProblem(
      await removeMember(await as(ctx, outsider), projectId, member.id),
      404,
      "not-found",
    );
    // The sandbox has no CSRF token (D3 of self-hosted Step 9): its session is the msid cookie alone.
    if (!sandbox) {
      await expectProblem(
        await removeMember(withoutCsrf(adam), projectId, member.id),
        403,
        "csrf-token-invalid",
      );
    }
    expect((await page(adam, projectId)).items).toEqual([
      memberOf(admin, "admin"),
      memberOf(member, "user"),
    ]);
  });
});
