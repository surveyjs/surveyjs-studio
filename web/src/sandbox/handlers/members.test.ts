import { describe, expect, it } from "vitest";
import { PROJECTS, setupSandbox, USERS } from "./testing";

const M = `/projects/${PROJECTS.marketing}`;
const patch = (json: unknown, user: string) => ({
  method: "PATCH",
  json,
  user,
  headers: { "Content-Type": "application/merge-patch+json" },
});
const post = (json: unknown, user: string) => ({ method: "POST", json, user });
const del = (user: string) => ({ method: "DELETE", user });

const member = (userId: string, displayName: string, email: string, role: string) => ({
  userId,
  displayName,
  email,
  role,
  status: "active",
});
const pending = (email: string, role = "user") => ({
  userId: null,
  displayName: email,
  email,
  role,
  status: "pending",
});

interface Page {
  items: { email: string }[];
  nextCursor: string | null;
}

describe("GET /projects/{projectId}/members", () => {
  it("lists the members by display name, then the pending ones by email", async () => {
    const { call } = setupSandbox();
    const response = await call(`${M}/members`, { user: USERS.member });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        member(USERS.admin, "Adam Admin", "admin@example.com", "admin"),
        member(USERS.member, "Mia Member", "member@example.com", "user"),
        member(USERS.owner, "Olivia Owner", "owner@example.com", "admin"),
        pending("invited@example.com"),
      ],
      nextCursor: null,
    });
  });

  it("pages across the pending row with cursors bound to the project", async () => {
    const { call } = setupSandbox();
    const emails: string[] = [];
    let cursor: string | null = null;
    let first: string | null = null;
    do {
      const query: string = `?limit=1${cursor ? `&cursor=${cursor}` : ""}`;
      const page: Page = await (await call(`${M}/members${query}`, { user: USERS.owner })).json();
      emails.push(...page.items.map((m) => m.email));
      first ??= page.nextCursor;
      cursor = page.nextCursor;
    } while (cursor);
    expect(emails).toEqual([
      "admin@example.com",
      "member@example.com",
      "owner@example.com",
      "invited@example.com",
    ]);
    for (const [project, query] of [
      [PROJECTS.engineering, `?cursor=${first}`],
      [PROJECTS.marketing, "?cursor=x"],
      [PROJECTS.marketing, "?limit=0"],
    ]) {
      const response = await call(`/projects/${project}/members${query}`, { user: USERS.owner });
      expect(response.status, query).toBe(400);
    }
  });

  it("answers 404 to a non-member and for an unknown project, 401 signed out", async () => {
    const { call } = setupSandbox();
    expect((await call(`${M}/members`, { user: USERS.outsider })).status).toBe(404);
    const unknown = "/projects/99999999-0000-4000-8000-a00000000099/members";
    expect((await call(unknown, { user: USERS.owner })).status).toBe(404);
    expect((await call(`${M}/members`)).status).toBe(401);
  });
});

describe("POST /projects/{projectId}/members", () => {
  it("adds a registered user by email in any case, as user by default", async () => {
    const { call } = setupSandbox();
    const path = `/projects/${PROJECTS.engineering}/members`;
    const response = await call(path, post({ email: "MEMBER@Example.COM" }, USERS.admin));
    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe(
      `/api/v1/projects/${PROJECTS.engineering}/members/${USERS.member}`,
    );
    expect(await response.json()).toEqual(
      member(USERS.member, "Mia Member", "member@example.com", "user"),
    );
    const again = await call(path, post({ email: "member@example.com" }, USERS.admin));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "already-member" });
  });

  it("makes an unknown email a pending member, listed after the members, and removes it", async () => {
    const { call } = setupSandbox();
    const response = await call(
      `${M}/members`,
      post({ email: "New.Person@Example.com", role: "admin" }, USERS.admin),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe(
      `/api/v1/projects/${PROJECTS.marketing}/invitations/new.person@example.com`,
    );
    expect(await response.json()).toEqual(pending("new.person@example.com", "admin"));

    const duplicate = await call(
      `${M}/members`,
      post({ email: "NEW.person@example.com" }, USERS.admin),
    );
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: "already-invited" });

    const listed: Page = await (await call(`${M}/members`, { user: USERS.admin })).json();
    expect(listed.items.slice(-2).map((m) => m.email)).toEqual([
      "invited@example.com",
      "new.person@example.com",
    ]);

    const removed = await call(`${M}/invitations/New.Person%40Example.com`, del(USERS.admin));
    expect(removed.status).toBe(204);
    const gone = await call(`${M}/invitations/new.person@example.com`, del(USERS.admin));
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ code: "not-found" });
    const after: Page = await (await call(`${M}/members`, { user: USERS.admin })).json();
    expect(after.items.map((m) => m.email)).not.toContain("new.person@example.com");
  });

  it("refuses a plain member with 403, a non-member with 404, and bad input with 422", async () => {
    const { call } = setupSandbox();
    const body = { email: "x@example.com" };
    expect((await call(`${M}/members`, post(body, USERS.member))).status).toBe(403);
    expect((await call(`${M}/members`, post(body, USERS.outsider))).status).toBe(404);
    for (const bad of [{ email: "not-an-email" }, { email: "a@b.co", role: "owner" }, {}]) {
      const response = await call(`${M}/members`, post(bad, USERS.admin));
      expect(response.status, JSON.stringify(bad)).toBe(422);
    }
    const byMember = await call(`${M}/invitations/invited@example.com`, del(USERS.member));
    expect(byMember.status).toBe(403);
  });
});

describe("PATCH /projects/{projectId}/members/{userId}", () => {
  it("promotes, demotes, keeps one admin, and refuses others", async () => {
    const { call } = setupSandbox();
    const path = `${M}/members/${USERS.member}`;
    const promoted = await call(path, patch({ role: "admin" }, USERS.admin));
    expect(promoted.status).toBe(200);
    expect(await promoted.json()).toEqual(
      member(USERS.member, "Mia Member", "member@example.com", "admin"),
    );
    expect((await call(path, patch({ role: "admin" }, USERS.admin))).status).toBe(200);
    // Three admins now; demote two, the last one cannot step down.
    const self = await call(`${M}/members/${USERS.admin}`, patch({ role: "user" }, USERS.admin));
    expect(self.status).toBe(200);
    const other = await call(`${M}/members/${USERS.owner}`, patch({ role: "user" }, USERS.member));
    expect(other.status).toBe(200);
    const last = await call(path, patch({ role: "user" }, USERS.member));
    expect(last.status).toBe(409);
    expect(await last.json()).toMatchObject({ code: "last-admin" });
  });

  it("refuses others: 403 for a plain member, 404 for non-members, 422 for a bad role", async () => {
    const { call } = setupSandbox();
    const path = `${M}/members/${USERS.admin}`;
    expect((await call(path, patch({ role: "user" }, USERS.member))).status).toBe(403);
    expect((await call(path, patch({ role: "user" }, USERS.outsider))).status).toBe(404);
    const stranger = await call(
      `${M}/members/${USERS.outsider}`,
      patch({ role: "user" }, USERS.admin),
    );
    expect(stranger.status).toBe(404);
    for (const body of [{}, { role: "owner" }]) {
      expect((await call(path, patch(body, USERS.admin))).status).toBe(422);
    }
    const long = await call(`${M}/members/${"x".repeat(65)}`, patch({ role: "user" }, USERS.admin));
    expect(long.status).toBe(400);
    expect(await long.json()).toMatchObject({ code: "bad-request" });
  });
});

describe("DELETE /projects/{projectId}/members/{userId}", () => {
  it("lets admins remove others and members leave, keeping one admin", async () => {
    const { call } = setupSandbox();
    const byMember = await call(`${M}/members/${USERS.admin}`, del(USERS.member));
    expect(byMember.status).toBe(403);
    expect((await call(`${M}/members/${USERS.member}`, del(USERS.member))).status).toBe(204);
    expect((await call(`${M}/members/${USERS.member}`, del(USERS.admin))).status).toBe(404);
    expect((await call(`${M}/members/${USERS.owner}`, del(USERS.admin))).status).toBe(204);
    const last = await call(`${M}/members/${USERS.admin}`, del(USERS.admin));
    expect(last.status).toBe(409);
    expect(await last.json()).toMatchObject({ code: "last-admin" });
  });

  it("answers 404 for a target or caller who is not a member", async () => {
    const { call } = setupSandbox();
    expect((await call(`${M}/members/${USERS.outsider}`, del(USERS.admin))).status).toBe(404);
    expect((await call(`${M}/members/${USERS.admin}`, del(USERS.outsider))).status).toBe(404);
    expect((await call(`${M}/members/${USERS.outsider}`, del(USERS.outsider))).status).toBe(404);
  });
});
