/**
 * The instance admin's `/admin/users` operations and project oversight (self-hosted Step 5), on the
 * local user directory: `pnpm test:conformance:password` (the other runs skip this file). The seed's
 * instance admin, Ivy Instance, signs in through the dev sign-in; the users this file creates set
 * their passwords with their links and sign in with them.
 *
 * Not here, because a shared server cannot arrange it: the last active instance admin (other files
 * sign in the first admin meanwhile) and a link's expiry after 7 days. The server's tests cover both
 * (server/src/admin/admin.test.ts, the account store suite).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, inject, it, type TestContext } from "vitest";
import { as, call, codeOf } from "./harness.js";
import { CookieJar, fixtureUsers } from "./sign-in.js";

const { instanceAdmin, owner } = fixtureUsers;
const PASSWORD = "a conformance user's password";
const MERGE_PATCH = "application/merge-patch+json";

interface CreatedUser {
  readonly user: { readonly id: string; readonly email: string; readonly status: string };
  readonly link: { readonly url: string; readonly expiresAt: string };
}

const tokenOf = (url: string) => new URL(url).searchParams.get("token") ?? "";

/** Creates a user as the instance admin; returns the answer's body. */
async function createUser(admin: Record<string, string>, name: string): Promise<CreatedUser> {
  const response = await call("POST", "/admin/users", {
    headers: admin,
    body: { email: `${name}-${randomBytes(4).toString("hex")}@example.com`, displayName: name },
  });
  expect(response.status).toBe(201);
  return (await response.json()) as CreatedUser;
}

async function setPassword(token: string, password = PASSWORD): Promise<Response> {
  return call("POST", "/auth/password-link", { body: { token, password } });
}

/** Signs in with the password; the browser's headers. */
async function signedIn(email: string): Promise<Record<string, string>> {
  const response = await call("POST", "/auth/password/login", {
    body: { email, password: PASSWORD },
  });
  expect(response.status).toBe(204);
  const jar = new CookieJar();
  jar.store(response);
  return { cookie: jar.header(), "x-csrf-token": jar.get("msid_csrf") ?? "" };
}

/** A new user with a password, signed in. */
async function activeUser(admin: Record<string, string>, name: string) {
  const created = await createUser(admin, name);
  expect((await setPassword(tokenOf(created.link.url))).status).toBe(204);
  return { ...created.user, headers: await signedIn(created.user.email) };
}

const patchUser = (admin: Record<string, string>, id: string, body: unknown) =>
  call("PATCH", "/admin/users/{userId}", {
    path: `/admin/users/${id}`,
    headers: { ...admin, "content-type": MERGE_PATCH },
    body,
  });

describe.skipIf(inject("passwordAdmin") === null)("the instance admin", () => {
  const admin = (ctx: TestContext) => as(ctx, instanceAdmin);

  it("listUsers lists the users by email, with role, status and last sign-in", async (ctx) => {
    const response = await call("GET", "/admin/users", {
      path: "/admin/users?limit=200",
      headers: await admin(ctx),
    });
    expect(response.status).toBe(200);
    const { items } = (await response.json()) as {
      items: { email: string; instanceRole: string; status: string }[];
    };
    const emails = items.map((user) => user.email);
    expect(emails).toEqual([...emails].sort());
    expect(items).toContainEqual(
      expect.objectContaining({
        email: instanceAdmin.email,
        instanceRole: "admin",
        status: "active",
      }),
    );
  });

  it("refuses the admin operations to anyone but an instance admin", async (ctx) => {
    const user = await as(ctx, owner);
    const refused = await call("GET", "/admin/users", { headers: user });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe("forbidden");
    expect((await call("GET", "/admin/users")).status).toBe(401);
    const create = await call("POST", "/admin/users", {
      headers: user,
      body: { email: "nobody@example.com", displayName: "Nobody" },
    });
    expect(create.status).toBe(403);
    // The destructive ones too, on a real user (the instance admin), so a 404 cannot hide a
    // missing check.
    const target = instanceAdmin.id;
    const writes = [
      call("PATCH", "/admin/users/{userId}", {
        path: `/admin/users/${target}`,
        headers: { ...user, "content-type": MERGE_PATCH },
        body: { status: "disabled" },
      }),
      call("DELETE", "/admin/users/{userId}", { path: `/admin/users/${target}`, headers: user }),
      call("POST", "/admin/users/{userId}/reset-link", {
        path: `/admin/users/${target}/reset-link`,
        headers: user,
      }),
    ];
    for (const refusedWrite of await Promise.all(writes)) {
      expect(refusedWrite.status).toBe(403);
      expect(await codeOf(refusedWrite)).toBe("forbidden");
    }
  });

  it("createUser returns a one-time link that sets the password; a used link gets 410", async (ctx) => {
    const created = await createUser(await admin(ctx), "invited");
    expect(created.user.status).toBe("invited");
    expect(created.link.url).toMatch(/\/set-password\?token=[A-Za-z0-9_-]{22}$/);
    const token = tokenOf(created.link.url);
    expect((await setPassword(token)).status).toBe(204);
    await signedIn(created.user.email);
    const used = await setPassword(token, "another long password");
    expect(used.status).toBe(410);
    expect(await codeOf(used)).toBe("link-invalid");
  });

  it("createUser refuses an email that has an account (409 email-taken)", async (ctx) => {
    const response = await call("POST", "/admin/users", {
      headers: await admin(ctx),
      body: { email: owner.email.toUpperCase(), displayName: "Owner again" },
    });
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe("email-taken");
  });

  it("updateUser disables a user, whose session ends, and enables them again", async (ctx) => {
    const headers = await admin(ctx);
    const user = await activeUser(headers, "disabled");
    const disabled = await patchUser(headers, user.id, { status: "disabled" });
    expect(disabled.status).toBe(200);
    expect((await call("GET", "/me", { headers: user.headers })).status).toBe(401);
    const enabled = await patchUser(headers, user.id, { status: "active" });
    expect(((await enabled.json()) as { status: string }).status).toBe("active");
    await signedIn(user.email);
  });

  it("updateUser changes the instance role, and answers 404 and 422", async (ctx) => {
    const headers = await admin(ctx);
    const user = await activeUser(headers, "promoted");
    const promoted = await patchUser(headers, user.id, { instanceRole: "admin" });
    expect(((await promoted.json()) as { instanceRole: string }).instanceRole).toBe("admin");
    expect((await call("GET", "/admin/users", { headers: user.headers })).status).toBe(200);
    const demoted = await patchUser(headers, user.id, { instanceRole: "user" });
    expect(demoted.status).toBe(200);
    expect((await patchUser(headers, randomUUID(), { status: "active" })).status).toBe(404);
    const invalid = await patchUser(headers, user.id, { status: "invited" });
    expect(invalid.status).toBe(422);
  });

  it("createUserResetLink ends the sessions and the password; the new link works", async (ctx) => {
    const headers = await admin(ctx);
    const user = await activeUser(headers, "reset");
    const reset = await call("POST", "/admin/users/{userId}/reset-link", {
      path: `/admin/users/${user.id}/reset-link`,
      headers,
    });
    expect(reset.status).toBe(201);
    const link = (await reset.json()) as { url: string };
    expect((await call("GET", "/me", { headers: user.headers })).status).toBe(401);
    const old = await call("POST", "/auth/password/login", {
      body: { email: user.email, password: PASSWORD },
    });
    expect(old.status).toBe(401);
    expect((await setPassword(tokenOf(link.url))).status).toBe(204);
    await signedIn(user.email);
  });

  it("deleteUser erases the user's data: their own project goes with them", async (ctx) => {
    const headers = await admin(ctx);
    const user = await activeUser(headers, "deleted");
    const project = await call("POST", "/projects", {
      headers: user.headers,
      body: { name: "Deleted with its only member" },
    });
    expect(project.status).toBe(201);
    const { id: projectId } = (await project.json()) as { id: string };

    const deleted = await call("DELETE", "/admin/users/{userId}", {
      path: `/admin/users/${user.id}`,
      headers,
    });
    expect(deleted.status).toBe(204);
    expect((await call("GET", "/me", { headers: user.headers })).status).toBe(401);
    // The instance admin sees every project: the user's is gone.
    const gone = await call("GET", "/projects/{projectId}", {
      path: `/projects/${projectId}`,
      headers,
    });
    expect(gone.status).toBe(404);
    const again = await call("DELETE", "/admin/users/{userId}", {
      path: `/admin/users/${user.id}`,
      headers,
    });
    expect(again.status).toBe(404);
  });

  it("manages a project it is not a member of; scope=all is for instance admins", async (ctx) => {
    const headers = await admin(ctx);
    const ownerHeaders = await as(ctx, owner);
    const created = await call("POST", "/projects", {
      headers: ownerHeaders,
      body: { name: "Owner's project" },
    });
    const { id: projectId } = (await created.json()) as { id: string };

    const all = await call("GET", "/projects", { path: "/projects?scope=all&limit=100", headers });
    expect(all.status).toBe(200);
    const listed: { id: string; role: string }[] = [];
    let page = (await all.json()) as { items: typeof listed; nextCursor: string | null };
    listed.push(...page.items);
    while (page.nextCursor !== null) {
      const next = await call("GET", "/projects", {
        path: `/projects?scope=all&limit=100&cursor=${encodeURIComponent(page.nextCursor)}`,
        headers,
      });
      page = (await next.json()) as typeof page;
      listed.push(...page.items);
    }
    expect(listed).toContainEqual(expect.objectContaining({ id: projectId, role: "admin" }));

    const renamed = await call("PATCH", "/projects/{projectId}", {
      path: `/projects/${projectId}`,
      headers: { ...headers, "content-type": MERGE_PATCH },
      body: { name: "Renamed by the instance admin" },
    });
    expect(renamed.status).toBe(200);
    const members = await call("GET", "/projects/{projectId}/members", {
      path: `/projects/${projectId}/members`,
      headers,
    });
    expect(members.status).toBe(200);
    const removed = await call("DELETE", "/projects/{projectId}", {
      path: `/projects/${projectId}`,
      headers,
    });
    expect(removed.status).toBe(204);

    const refused = await call("GET", "/projects", {
      path: "/projects?scope=all",
      headers: ownerHeaders,
    });
    expect(refused.status).toBe(403);
  });
});
