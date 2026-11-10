/**
 * OAuth2 sign-in on the local user directory (`pnpm test:conformance:oauth`, self-hosted Step 8):
 * Google, GitHub, Facebook and surveyjs.io, all against the OAuth stub the global setup starts.
 * A sign-in reaches an existing account only through a linked identity or a verified email; new
 * accounts are made only for an invited email, a SIGN_UP_DOMAINS domain or with OPEN_SIGN_UP=on;
 * pending invitations become memberships at sign-in by any method; refusals end on the web app's
 * `/sign-in/refused` page without a session.
 *
 * Runs only with `CONFORMANCE_AUTH=oauth` (the other runs skip it). The fixture users (the
 * project owner and the instance admin) still sign in through the dev sign-in.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, inject, it, onTestFinished, type TestContext } from "vitest";
import { as, baseUrl, call, expectConforms } from "./harness.js";
import {
  authorizeAtStub,
  CookieJar,
  fixtureUsers,
  oauthSignIn,
  openCallback,
  type OAuthSignIn,
  type StubMethod,
} from "./sign-in.js";

const oauth = inject("oauth");
const firstAdmin = inject("passwordAdmin");
const { owner, instanceAdmin } = fixtureUsers;
const MERGE_PATCH = "application/merge-patch+json";
const NEW_ADMIN_PASSWORD = "the first admin's own new password";
const USER_PASSWORD = "an oauth conformance user's password";

const METHODS: readonly StubMethod[] = ["google", "github", "facebook", "surveyjs"];

/** A provider subject and an email local part nobody else in the run uses. */
const unique = (prefix: string) => `${prefix}-${randomBytes(5).toString("hex")}`;

interface Me {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly instanceRole?: string;
  readonly hasPassword?: boolean;
  readonly mustChangePassword?: boolean;
}

/** The callback conforms; then the session's `getCurrentUser`. */
async function signedInAs(result: OAuthSignIn, server = baseUrl): Promise<Me> {
  await expectConforms("GET", "/auth/callback", result.callback);
  expect(result.callback.status).toBe(302);
  expect(result.location.href).toBe(`${server}/`);
  expect(result.jar.get("msid")).toBeDefined();
  const me = await fetch(`${server}/api/v1/me`, { headers: { cookie: result.jar.header() } });
  await expectConforms("GET", "/me", me);
  expect(me.status).toBe(200);
  return (await me.json()) as Me;
}

/** The callback sent the browser to the refused page, with no session. */
async function expectRefused(result: OAuthSignIn, reason: string, provider: StubMethod) {
  await expectConforms("GET", "/auth/callback", result.callback);
  expect(result.callback.status).toBe(302);
  expect(result.location.pathname).toBe("/sign-in/refused");
  expect(Object.fromEntries(result.location.searchParams)).toEqual({ reason, provider });
  expect(result.jar.get("msid")).toBeUndefined();
  expect(result.jar.get("msid_csrf")).toBeUndefined();
  // The sign-in's transaction cookie is cleared.
  expect(result.jar.header()).not.toContain("msid_auth_");
}

/** A new project of the owner, deleted when the test ends. */
async function ownersProject(
  ctx: TestContext,
): Promise<{ id: string; headers: Record<string, string> }> {
  const headers = await as(ctx, owner);
  const created = await call("POST", "/projects", {
    headers,
    body: { name: `OAuth conformance ${randomUUID().slice(0, 8)}` },
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  onTestFinished(async () => {
    const deleted = await call("DELETE", "/projects/{projectId}", {
      path: `/projects/${id}`,
      headers,
    });
    expect(deleted.status).toBe(204);
  });
  return { id, headers };
}

/** Invites `email` to the project: a pending member. */
async function invite(headers: Record<string, string>, projectId: string, email: string) {
  const added = await call("POST", "/projects/{projectId}/members", {
    path: `/projects/${projectId}/members`,
    headers,
    body: { email, role: "user" },
  });
  expect(added.status).toBe(201);
  expect(await added.json()).toMatchObject({ status: "pending", userId: null });
}

interface Member {
  readonly userId: string | null;
  readonly email: string;
  readonly status: string;
}

async function membersOf(headers: Record<string, string>, projectId: string): Promise<Member[]> {
  const response = await call("GET", "/projects/{projectId}/members", {
    path: `/projects/${projectId}/members?limit=200`,
    headers,
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: Member[] }).items;
}

/** The instance admin's list of users with this email (lower-case). */
async function usersWithEmail(
  ctx: TestContext,
  email: string,
): Promise<{ id: string; status: string }[]> {
  const response = await call("GET", "/admin/users", {
    path: "/admin/users?limit=200",
    headers: await as(ctx, instanceAdmin),
  });
  expect(response.status).toBe(200);
  const { items } = (await response.json()) as {
    items: { id: string; email: string; status: string }[];
  };
  return items.filter((user) => user.email === email.toLowerCase());
}

describe.skipIf(oauth === null || firstAdmin === null)("OAuth2 sign-in (local directory)", () => {
  const { signUpDomain, openSignUpBaseUrl } = oauth ?? { signUpDomain: "", openSignUpBaseUrl: "" };

  for (const method of METHODS) {
    it(`${method}: an invited email lands signed in to a new local account, a member (S37)`, async (ctx) => {
      const project = await ownersProject(ctx);
      const local = unique(method);
      // Invited in mixed case, signed in in lower case (Review Focus 3).
      await invite(project.headers, project.id, `${local}@Invited.Example`);
      const me = await signedInAs(
        await oauthSignIn(baseUrl, method, {
          sub: unique("sub"),
          email: `${local}@invited.example`,
          name: `${method} person`,
        }),
      );
      expect(me).toMatchObject({
        email: `${local}@invited.example`,
        displayName: `${method} person`,
        instanceRole: "user",
        mustChangePassword: false,
        hasPassword: false,
      });
      const members = await membersOf(project.headers, project.id);
      expect(members).toContainEqual(expect.objectContaining({ userId: me.id, status: "active" }));
      expect(members.filter((member) => member.status === "pending")).toEqual([]);
    });
  }

  it("refuses a stranger: not-invited, no account", async (ctx) => {
    const email = `${unique("stranger")}@elsewhere.example`;
    await expectRefused(
      await oauthSignIn(baseUrl, "google", { sub: unique("sub"), email }),
      "not-invited",
      "google",
    );
    expect(await usersWithEmail(ctx, email)).toEqual([]);
  });

  it("creates an account for an email of SIGN_UP_DOMAINS, not for a lookalike domain", async () => {
    const local = unique("x");
    const me = await signedInAs(
      await oauthSignIn(baseUrl, "github", {
        sub: unique("sub"),
        email: `${local}@${signUpDomain}`,
      }),
    );
    expect(me).toMatchObject({ email: `${local}@${signUpDomain}`, hasPassword: false });
    for (const email of [`${local}@sub.${signUpDomain}`, `${local}@evil-${signUpDomain}`]) {
      await expectRefused(
        await oauthSignIn(baseUrl, "github", { sub: unique("sub"), email }),
        "not-invited",
        "github",
      );
    }
  });

  it("OPEN_SIGN_UP=on creates an account for any verified email; unverified is refused", async () => {
    const email = `${unique("anyone")}@open.example`;
    const me = await signedInAs(
      await oauthSignIn(openSignUpBaseUrl, "facebook", { sub: unique("sub"), email }),
      openSignUpBaseUrl,
    );
    expect(me).toMatchObject({ email, hasPassword: false });
    await expectRefused(
      await oauthSignIn(openSignUpBaseUrl, "google", {
        sub: unique("sub"),
        email: `${unique("anyone")}@open.example`,
        verified: false,
      }),
      "email-unverified",
      "google",
    );
  });

  it("links Google to the first admin's account by its verified email: the same id (S36)", async (ctx) => {
    const { email, password } = firstAdmin ?? { email: "", password: "" };
    // The first admin signs in with the password from ADMIN_PASSWORD and changes it first.
    const login = await call("POST", "/auth/password/login", { body: { email, password } });
    expect(login.status).toBe(204);
    const jar = new CookieJar();
    jar.store(login);
    const headers = { cookie: jar.header(), "x-csrf-token": jar.get("msid_csrf") ?? "" };
    const changed = await call("POST", "/me/password", {
      headers,
      body: { currentPassword: password, newPassword: NEW_ADMIN_PASSWORD },
    });
    expect(changed.status).toBe(204);
    jar.store(changed);
    const byPassword = await call("GET", "/me", { headers: { cookie: jar.header() } });
    const admin = (await byPassword.json()) as Me;

    // Without a verified email, the same address neither reaches the account nor makes another
    // one (Review Focus 1).
    await expectRefused(
      await oauthSignIn(baseUrl, "google", { sub: unique("sub"), email, verified: false }),
      "email-unverified",
      "google",
    );

    const sub = unique("sub");
    const me = await signedInAs(
      await oauthSignIn(baseUrl, "google", { sub, email: email.toUpperCase() }),
    );
    expect(me).toMatchObject({ id: admin.id, instanceRole: "admin", hasPassword: true });
    // The linked identity signs in again, whatever email the provider now gives.
    const again = await signedInAs(
      await oauthSignIn(baseUrl, "google", { sub, email: `${unique("moved")}@elsewhere.example` }),
    );
    expect(again.id).toBe(admin.id);
    expect(await usersWithEmail(ctx, email)).toHaveLength(1);
  });

  it("claims a pending invitation for a user the instance admin created, who signs in with a password", async (ctx) => {
    const project = await ownersProject(ctx);
    const email = `${unique("pw")}@example.com`;
    await invite(project.headers, project.id, email.toUpperCase());
    const created = await call("POST", "/admin/users", {
      headers: await as(ctx, instanceAdmin),
      body: { email, displayName: "Password Person" },
    });
    expect(created.status).toBe(201);
    const { user, link } = (await created.json()) as {
      user: { id: string };
      link: { url: string };
    };
    const token = new URL(link.url).searchParams.get("token") ?? "";
    const set = await call("POST", "/auth/password-link", {
      body: { token, password: USER_PASSWORD },
    });
    expect(set.status).toBe(204);
    const login = await call("POST", "/auth/password/login", {
      body: { email, password: USER_PASSWORD },
    });
    expect(login.status).toBe(204);
    const members = await membersOf(project.headers, project.id);
    expect(members).toContainEqual(expect.objectContaining({ userId: user.id, status: "active" }));
    expect(members.filter((member) => member.status === "pending")).toEqual([]);
  });

  it("refuses a disabled user's linked identity: disabled, no session (Review Focus 4)", async (ctx) => {
    const person = { sub: unique("sub"), email: `${unique("dis")}@${signUpDomain}` };
    const me = await signedInAs(await oauthSignIn(baseUrl, "github", person));
    const disabled = await call("PATCH", "/admin/users/{userId}", {
      path: `/admin/users/${me.id}`,
      headers: { ...(await as(ctx, instanceAdmin)), "content-type": MERGE_PATCH },
      body: { status: "disabled" },
    });
    expect(disabled.status).toBe(200);
    await expectRefused(await oauthSignIn(baseUrl, "github", person), "disabled", "github");
  });

  it("the instance admin lists a user's linked sign-ins and unlinks one: it no longer signs in", async (ctx) => {
    const person = { sub: unique("sub"), email: `${unique("unlink")}@${signUpDomain}` };
    const me = await signedInAs(await oauthSignIn(baseUrl, "github", person));
    // The provider gives another email now: only the link still leads to the account.
    const moved = { ...person, email: `${unique("moved")}@elsewhere.example` };
    const session = await oauthSignIn(baseUrl, "github", moved);
    expect((await signedInAs(session)).id).toBe(me.id);

    const admin = await as(ctx, instanceAdmin);
    const listed = await call("GET", "/admin/users/{userId}/identities", {
      path: `/admin/users/${me.id}/identities`,
      headers: admin,
    });
    expect(listed.status).toBe(200);
    const { items } = (await listed.json()) as { items: { subject: string }[] };
    // GitHub's subject is its numeric user id, which the stub derives from `sub`.
    expect(items).toEqual([
      {
        provider: "github",
        subject: expect.any(String) as unknown,
        email: person.email,
        linkedAt: expect.any(String) as unknown,
      },
    ]);

    const subject = items[0]?.subject ?? "";
    const path = `/admin/users/${me.id}/identities/github/${encodeURIComponent(subject)}`;
    const unlinked = await call("DELETE", "/admin/users/{userId}/identities/{provider}/{subject}", {
      path,
      headers: admin,
    });
    expect(unlinked.status).toBe(204);
    // The session the identity made has ended, and the identity reaches no account now.
    const after = await call("GET", "/me", { headers: { cookie: session.jar.header() } });
    expect(after.status).toBe(401);
    await expectRefused(await oauthSignIn(baseUrl, "github", moved), "not-invited", "github");
    const again = await call("DELETE", "/admin/users/{userId}/identities/{provider}/{subject}", {
      path,
      headers: admin,
    });
    expect(again.status).toBe(404);
  });

  it("makes one account when the same new identity signs in twice at once (Review Focus 5)", async (ctx) => {
    const person = { sub: unique("sub"), email: `${unique("twice")}@${signUpDomain}` };
    const authorized = await Promise.all([
      authorizeAtStub(baseUrl, "google", person),
      authorizeAtStub(baseUrl, "google", person),
    ]);
    const results = await Promise.all(authorized.map(openCallback));
    const [first, second] = await Promise.all(results.map((result) => signedInAs(result)));
    expect(first?.id).toBe(second?.id);
    expect(await usersWithEmail(ctx, person.email)).toHaveLength(1);
  });

  it("shows hasPassword: false for the seed's users, local accounts without a password", async (ctx) => {
    const me = await call("GET", "/me", { headers: await as(ctx, owner) });
    expect(await me.json()).toMatchObject({ id: owner.id, hasPassword: false });
  });
});
