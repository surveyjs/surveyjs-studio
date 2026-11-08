import { describe, expect, it } from "vitest";
import { PROJECTS, setupSandbox, SURVEYS, USERS } from "./testing";

const patch = (json: unknown, user: string | null = null) => ({
  method: "PATCH",
  json,
  user,
  headers: { "Content-Type": "application/merge-patch+json" },
});
const post = (json: unknown, user: string | null) => ({ method: "POST", json, user });

describe("GET /projects", () => {
  it("lists the caller's projects by name, with their role", async () => {
    const { call } = setupSandbox();
    const page = await (await call("/projects", { user: USERS.owner })).json();
    expect(page).toEqual({
      items: [
        {
          id: PROJECTS.engineering,
          name: "Engineering",
          ownerId: USERS.admin,
          role: "user",
          memberCount: 2,
          createdAt: "2025-12-01T09:00:00.000Z",
        },
        {
          id: PROJECTS.marketing,
          name: "Marketing",
          ownerId: USERS.owner,
          role: "admin",
          memberCount: 3,
          createdAt: "2025-11-21T10:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
  });

  it("shows the member Marketing only and the outsider nothing", async () => {
    const { call } = setupSandbox();
    const member = await (await call("/projects", { user: USERS.member })).json();
    expect(member.items.map((p: { id: string }) => p.id)).toEqual([PROJECTS.marketing]);
    const outsider = await (await call("/projects", { user: USERS.outsider })).json();
    expect(outsider).toEqual({ items: [], nextCursor: null });
  });

  it("pages with cursors and refuses a bad one, a members cursor and a limit of 0", async () => {
    const { call } = setupSandbox();
    const first = await (await call("/projects?limit=1", { user: USERS.owner })).json();
    expect(first.items.map((p: { name: string }) => p.name)).toEqual(["Engineering"]);
    const second = await (
      await call(`/projects?limit=1&cursor=${first.nextCursor}`, { user: USERS.owner })
    ).json();
    expect(second.items.map((p: { name: string }) => p.name)).toEqual(["Marketing"]);
    expect(second.nextCursor).toBeNull();

    const members = await (
      await call(`/projects/${PROJECTS.marketing}/members?limit=1`, { user: USERS.owner })
    ).json();
    for (const query of ["?cursor=abc", `?cursor=${members.nextCursor}`, "?limit=0", "?scope=x"]) {
      const response = await call(`/projects${query}`, { user: USERS.owner });
      expect(response.status, query).toBe(400);
      expect(await response.json()).toMatchObject({ code: "bad-request" });
    }
  });

  it("answers 403 to scope=all (there is no instance admin) and 401 signed out", async () => {
    const { call } = setupSandbox();
    const all = await call("/projects?scope=all", { user: USERS.owner });
    expect(all.status).toBe(403);
    expect(await all.json()).toMatchObject({ code: "forbidden" });
    expect((await call("/projects")).status).toBe(401);
  });
});

describe("GET /projects/{projectId}", () => {
  it("answers a project to its member and 404 to others, unknown ids included", async () => {
    const { call } = setupSandbox();
    const ok = await call(`/projects/${PROJECTS.marketing}`, { user: USERS.member });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ name: "Marketing", role: "user", memberCount: 3 });
    for (const id of [PROJECTS.engineering, "99999999-0000-4000-8000-a00000000099"]) {
      const response = await call(`/projects/${id}`, { user: USERS.member });
      expect(response.status, id).toBe(404);
      expect(await response.json()).toMatchObject({ code: "not-found" });
    }
    const long = await call(`/projects/${"x".repeat(65)}`, { user: USERS.member });
    expect(long.status).toBe(400);
  });
});

describe("POST /projects", () => {
  it("creates a project the creator administers, then the member can be added to it", async () => {
    const { call } = setupSandbox();
    const created = await call("/projects", post({ name: "Sales" }, USERS.admin));
    expect(created.status).toBe(201);
    const project = await created.json();
    expect(created.headers.get("location")).toBe(`/api/v1/projects/${project.id}`);
    expect(project).toMatchObject({
      name: "Sales",
      ownerId: USERS.admin,
      role: "admin",
      memberCount: 1,
    });
    const added = await call(
      `/projects/${project.id}/members`,
      post({ email: "member@example.com" }, USERS.admin),
    );
    expect(added.status).toBe(201);
    const listed = await (await call("/projects", { user: USERS.member })).json();
    expect(listed.items.map((p: { name: string }) => p.name)).toEqual(["Marketing", "Sales"]);
  });

  it("allows 128 characters and refuses 129, none, empty and blank with 422", async () => {
    const { call } = setupSandbox();
    const long = await call("/projects", post({ name: "x".repeat(128) }, USERS.admin));
    expect(long.status).toBe(201);
    for (const body of [{ name: "x".repeat(129) }, {}, { name: "" }, { name: "  " }]) {
      const response = await call("/projects", post(body, USERS.admin));
      expect(response.status, JSON.stringify(body)).toBe(422);
      expect(await response.json()).toMatchObject({ code: "validation-failed" });
    }
    const malformed = await call("/projects", {
      method: "POST",
      user: USERS.admin,
      body: "{",
      headers: { "Content-Type": "application/json" },
    });
    expect(malformed.status).toBe(400);
  });
});

describe("PATCH /projects/{projectId}", () => {
  it("renames for an admin, keeping the owner and creation time", async () => {
    const { call } = setupSandbox();
    const path = `/projects/${PROJECTS.marketing}`;
    const before = await (await call(path, { user: USERS.admin })).json();
    const response = await call(path, patch({ name: "Growth" }, USERS.admin));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...before, name: "Growth" });
  });

  it("refuses a plain member with 403, others with 404, and bad input with 422", async () => {
    const { call } = setupSandbox();
    const path = `/projects/${PROJECTS.marketing}`;
    expect((await call(path, patch({ name: "X" }, USERS.member))).status).toBe(403);
    expect((await call(path, patch({ name: "X" }, USERS.outsider))).status).toBe(404);
    for (const body of [{}, { name: " " }]) {
      const response = await call(path, patch(body, USERS.admin));
      expect(response.status, JSON.stringify(body)).toBe(422);
    }
    expect((await call(path, patch({ name: "X" }))).status).toBe(401);
  });
});

describe("DELETE /projects/{projectId}", () => {
  it("moves the surveys to the owner (a member) and drops memberships and invitations", async () => {
    const { call, ctx } = setupSandbox();
    const response = await call(`/projects/${PROJECTS.marketing}`, {
      method: "DELETE",
      user: USERS.admin,
    });
    expect(response.status).toBe(204);
    const data = ctx.store.read();
    for (const id of [SURVEYS.campaign, SURVEYS.archivedCampaign]) {
      const survey = data.surveys.find((s) => s.id === id)!;
      expect(survey.owner).toEqual({ kind: "personal", userId: USERS.owner });
    }
    // The creator is kept; the other project's survey stays.
    expect(data.surveys.find((s) => s.id === SURVEYS.campaign)!.creatorId).toBe(USERS.member);
    expect(data.surveys.find((s) => s.id === SURVEYS.retro)!.owner).toMatchObject({
      kind: "project",
    });
    expect(data.projects.map((p) => p.id)).toEqual([PROJECTS.engineering]);
    expect(data.memberships.every((m) => m.projectId === PROJECTS.engineering)).toBe(true);
    expect(data.invitations).toEqual([]);
    expect((await call(`/projects/${PROJECTS.marketing}`, { user: USERS.owner })).status).toBe(404);
    const mine = await (await call("/surveys", { user: USERS.owner })).json();
    expect(mine.items.map((s: { id: string }) => s.id)).toContain(SURVEYS.campaign);
  });

  it("moves the surveys to the deleting admin once the owner has left", async () => {
    const { call, ctx } = setupSandbox();
    const left = await call(`/projects/${PROJECTS.marketing}/members/${USERS.owner}`, {
      method: "DELETE",
      user: USERS.owner,
    });
    expect(left.status).toBe(204);
    await call(`/projects/${PROJECTS.marketing}`, { method: "DELETE", user: USERS.admin });
    const survey = ctx.store.read().surveys.find((s) => s.id === SURVEYS.campaign)!;
    expect(survey.owner).toEqual({ kind: "personal", userId: USERS.admin });
  });

  it("refuses a plain member with 403 and others with 404", async () => {
    const { call } = setupSandbox();
    const path = `/projects/${PROJECTS.marketing}`;
    expect((await call(path, { method: "DELETE", user: USERS.member })).status).toBe(403);
    expect((await call(path, { method: "DELETE", user: USERS.outsider })).status).toBe(404);
    expect((await call(path, { user: USERS.admin })).status).toBe(200);
  });
});
