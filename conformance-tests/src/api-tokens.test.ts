/**
 * API tokens and legacy access keys (ADR 0037): `listApiTokens`, `createApiToken`,
 * `revokeApiToken`, `revokeLegacyAccessKey` and `replaceCurrentCredential`, and what a token
 * reaches through the survey and project operations.
 *
 * Data rules: the data is shared by all test files and never reset (the Azurite replica keeps it
 * between runs). Every token a test creates is revoked at the end of the test (`onTestFinished`),
 * so no usable token outlives a run. Project tokens live in a project the test creates as Adam
 * Admin (`Conformance tokens <random>`), with Mia Member as its only other member, and deleted at
 * the end; its surveys move to Adam's Personal scope, where his session deletes them. The legacy
 * cases use the fixture users' keys and skip where the server has none (the SQL providers). Only
 * Oscar Outsider's key is ever revoked, and only where `features.legacyKeyRevoke` is on: the
 * memory run, which starts afresh each time.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it, onTestFinished, type TestContext } from "vitest";
import { as, call, cleanUp, codeOf, sandbox } from "./harness.js";
import { fixtureUsers } from "./sign-in.js";

const { owner, admin, member, outsider } = fixtureUsers;

/** The fixture users' legacy access keys (server/fixtures/legacy). */
const LEGACY_KEYS = {
  owner: "access-key-1",
  outsider: "access-key-4",
  blocked: "access-key-5",
} as const;

const MERGE_PATCH = "application/merge-patch+json";
const TOKEN_VALUE = /^sjs_[A-Za-z0-9_-]{43}$/;

type Headers = Record<string, string>;

interface ApiToken {
  id: string;
  name: string;
  projectId: string | null;
  lastFour: string;
  createdAt: string;
  lastUsedAt: string | null;
  createdBy: { id: string; displayName: string };
}

interface ApiTokenList {
  legacyKey: { lastFour: string; revocable: boolean } | null;
  tokens: ApiToken[];
}

const bearer = (value: string): Headers => ({ authorization: `Bearer ${value}` });

const uniqueName = (purpose: string): string =>
  `Conformance ${purpose} ${randomUUID().slice(0, 8)}`;

async function list(headers: Headers, projectId?: string): Promise<Response> {
  return call("GET", "/api-tokens", {
    path: projectId === undefined ? "/api-tokens" : `/api-tokens?project=${projectId}`,
    headers,
  });
}

async function listed(headers: Headers, projectId?: string): Promise<ApiTokenList> {
  const response = await list(headers, projectId);
  expect(response.status).toBe(200);
  return (await response.json()) as ApiTokenList;
}

function create(headers: Headers, projectId: string | null): Promise<Response> {
  return call("POST", "/api-tokens", {
    headers,
    body: { name: uniqueName("token"), projectId },
  });
}

function revoke(headers: Headers, id: string): Promise<Response> {
  return call("DELETE", "/api-tokens/{tokenId}", { path: `/api-tokens/${id}`, headers });
}

/** Creates a token as the session and registers its revocation (by the same session). */
async function createdToken(
  headers: Headers,
  projectId: string | null,
): Promise<{ token: ApiToken; value: string }> {
  const response = await create(headers, projectId);
  expect(response.status).toBe(201);
  const created = (await response.json()) as { token: ApiToken; value: string };
  onTestFinished(async () => {
    // Already revoked, or gone with its project: 404.
    expect([204, 404]).toContain((await revoke(headers, created.token.id)).status);
  });
  return created;
}

/** `GET /surveys` (the credential's own space, or `project`) with the headers; the status. */
async function surveysStatus(headers: Headers, project?: string): Promise<number> {
  const path = project === undefined ? "/surveys" : `/surveys?project=${project}`;
  return (await call("GET", "/surveys", { path, headers })).status;
}

async function surveyIds(headers: Headers): Promise<string[]> {
  const response = await call("GET", "/surveys", { path: "/surveys?limit=200", headers });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: { id: string }[] }).items.map((item) => item.id);
}

/** Creates a survey with the headers (a token's, maybe) and registers its cleanup by `cleaner`. */
async function createdSurvey(
  headers: Headers,
  cleaner: Headers,
  body: object = {},
): Promise<{ id: string; projectId: string | null }> {
  const response = await call("POST", "/surveys", {
    headers,
    body: { name: uniqueName("token survey"), ...body },
  });
  expect(response.status).toBe(201);
  const survey = (await response.json()) as { id: string; projectId: string | null };
  onTestFinished(() => cleanUp(cleaner, survey.id));
  return survey;
}

/** A project of Adam's with Mia as a plain member, deleted at the end of the test. */
async function adamsProject(adam: Headers): Promise<string> {
  const response = await call("POST", "/projects", {
    headers: adam,
    body: { name: uniqueName("tokens") },
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  onTestFinished(async () => {
    const deleted = await call("DELETE", "/projects/{projectId}", {
      path: `/projects/${id}`,
      headers: adam,
    });
    expect([204, 404]).toContain(deleted.status);
  });
  const added = await call("POST", "/projects/{projectId}/members", {
    path: `/projects/${id}/members`,
    headers: adam,
    body: { email: member.email, role: "user" },
  });
  expect(added.status).toBe(201);
  return id;
}

function replace(headers: Headers): Promise<Response> {
  return call("POST", "/me/credential", { headers });
}

async function features(): Promise<{ legacyKeyRevoke: boolean }> {
  const response = await call("GET", "/config");
  return ((await response.json()) as { features: { legacyKeyRevoke: boolean } }).features;
}

/** Olivia's legacy key in her list; skips the test where the server has no legacy keys. */
async function legacyKeyOrSkip(
  ctx: TestContext,
): Promise<{ lastFour: string; revocable: boolean }> {
  const { legacyKey } = await listed(await as(ctx, owner));
  if (legacyKey === null) ctx.skip("this server has no legacy access keys");
  return legacyKey!;
}

describe.skipIf(sandbox)("API tokens", () => {
  it("shows a new value once: never in the list, which holds the token", async (ctx) => {
    const adam = await as(ctx, admin);
    const { token, value } = await createdToken(adam, null);
    expect(value).toMatch(TOKEN_VALUE);
    expect(token).toMatchObject({
      projectId: null,
      lastFour: value.slice(-4),
      lastUsedAt: null,
      createdBy: { id: admin.id, displayName: admin.displayName },
    });

    const response = await list(adam);
    expect(response.status).toBe(200);
    const text = await response.clone().text();
    expect(text).not.toContain(value);
    const { tokens } = (await response.json()) as ApiTokenList;
    const mine = tokens.find((t) => t.id === token.id);
    expect(mine).toEqual(token);
    expect(mine).not.toHaveProperty("value");
  });

  it("authenticates a Personal token until it is revoked", async (ctx) => {
    const adam = await as(ctx, admin);
    const { token, value } = await createdToken(adam, null);
    const survey = await createdSurvey(adam, adam);
    expect(await surveyIds(bearer(value))).toContain(survey.id);

    expect((await revoke(adam, token.id)).status).toBe(204);
    expect(await surveysStatus(bearer(value))).toBe(401);
    expect((await listed(adam)).tokens.map((t) => t.id)).not.toContain(token.id);
    // Already revoked: as unknown.
    expect((await revoke(adam, token.id)).status).toBe(404);
  });

  it("takes a bearer write without a CSRF token, also next to a session cookie", async (ctx) => {
    const adam = await as(ctx, admin);
    const { value } = await createdToken(adam, null);
    const created = await createdSurvey(bearer(value), adam);
    expect(created.projectId).toBeNull();
    // The cookie without its CSRF header: the bearer value decides.
    const both = await createdSurvey({ cookie: adam.cookie ?? "", ...bearer(value) }, adam);
    expect(both.projectId).toBeNull();
  });

  it("keeps a project token in its project", async (ctx) => {
    const adam = await as(ctx, admin);
    const projectId = await adamsProject(adam);
    const { token, value } = await createdToken(adam, projectId);
    expect(token.projectId).toBe(projectId);
    const tokenHeaders = bearer(value);

    const inProject = await createdSurvey(tokenHeaders, adam);
    expect(inProject.projectId).toBe(projectId);
    expect(await surveyIds(tokenHeaders)).toEqual([inProject.id]);

    // Personal, another project of Adam's, and Adam's personal survey: as unknown.
    const personal = await createdSurvey(adam, adam);
    const engineering = "55555555-0000-4000-8000-a00000000002";
    expect(await surveysStatus(tokenHeaders, "personal")).toBe(404);
    expect(await surveysStatus(tokenHeaders, engineering)).toBe(404);
    const other = await call("GET", "/surveys/{surveyId}", {
      path: `/surveys/${personal.id}`,
      headers: tokenHeaders,
    });
    expect(other.status).toBe(404);
    const into = await call("POST", "/surveys", {
      headers: tokenHeaders,
      body: { name: uniqueName("token survey"), projectId: null },
    });
    expect(into.status).toBe(404);
    const moved = await call("PATCH", "/surveys/{surveyId}", {
      path: `/surveys/${inProject.id}`,
      headers: { "content-type": MERGE_PATCH, ...tokenHeaders },
      body: { projectId: engineering },
    });
    expect(moved.status).toBe(404);

    // The project, as its admin; no other project.
    const projects = await call("GET", "/projects", { headers: tokenHeaders });
    expect(projects.status).toBe(200);
    expect(await projects.json()).toMatchObject({ items: [{ id: projectId, role: "admin" }] });
  });

  it("lets only the project's admins list and create its tokens", async (ctx) => {
    const adam = await as(ctx, admin);
    const mia = await as(ctx, member);
    const oscar = await as(ctx, outsider);
    const projectId = await adamsProject(adam);
    const { token } = await createdToken(adam, projectId);

    const ofProject = await listed(adam, projectId);
    expect(ofProject.legacyKey).toBeNull();
    expect(ofProject.tokens.map((t) => t.id)).toEqual([token.id]);
    // Not in Adam's Personal list.
    expect((await listed(adam)).tokens.map((t) => t.id)).not.toContain(token.id);

    for (const [headers, status] of [
      [mia, 403],
      [oscar, 404],
    ] as const) {
      const listedAs = await list(headers, projectId);
      expect(listedAs.status).toBe(status);
      const created = await create(headers, projectId);
      expect(created.status).toBe(status);
      expect(await codeOf(created)).toBe(status === 403 ? "forbidden" : "not-found");
      // Revoking a token out of reach: as unknown.
      expect((await revoke(headers, token.id)).status).toBe(404);
    }
    const unknown = await create(adam, randomUUID());
    expect(unknown.status).toBe(404);
  });

  it("revokes only the caller's own Personal tokens", async (ctx) => {
    const adam = await as(ctx, admin);
    const mia = await as(ctx, member);
    const { token, value } = await createdToken(adam, null);
    expect((await revoke(mia, token.id)).status).toBe(404);
    expect((await revoke(mia, randomUUID())).status).toBe(404);
    expect(await surveysStatus(bearer(value))).toBe(200);
  });

  it("refuses token management to any bearer credential", async (ctx) => {
    const adam = await as(ctx, admin);
    const { token, value } = await createdToken(adam, null);
    expect((await list(bearer(value))).status).toBe(401);
    expect((await create(bearer(value), null)).status).toBe(401);
    expect((await revoke(bearer(value), token.id)).status).toBe(401);
    expect(await surveysStatus(bearer(value))).toBe(200);
  });

  it("replaces the token of the request: same token, new value, the old one stops", async (ctx) => {
    const adam = await as(ctx, admin);
    const { token, value } = await createdToken(adam, null);
    const replaced = await replace(bearer(value));
    expect(replaced.status).toBe(200);
    const { value: next } = (await replaced.json()) as { value: string };
    expect(next).toMatch(TOKEN_VALUE);
    expect(next).not.toBe(value);
    expect(await surveysStatus(bearer(value))).toBe(401);
    expect(await surveysStatus(bearer(next))).toBe(200);
    const [same] = (await listed(adam)).tokens.filter((t) => t.id === token.id);
    expect(same).toEqual({ ...token, lastFour: next.slice(-4), lastUsedAt: expect.any(String) });

    // A session cannot use it; a revoked token cannot replace itself.
    expect((await replace(adam)).status).toBe(401);
    expect((await revoke(adam, token.id)).status).toBe(204);
    const afterRevoke = await replace(bearer(next));
    expect(afterRevoke.status).toBe(401);
    expect(await codeOf(afterRevoke)).toBe("unauthenticated");
  });

  it("revokes a project's tokens when the project is deleted", async (ctx) => {
    const adam = await as(ctx, admin);
    const projectId = await adamsProject(adam);
    const { value } = await createdToken(adam, projectId);
    expect(await surveysStatus(bearer(value))).toBe(200);
    const deleted = await call("DELETE", "/projects/{projectId}", {
      path: `/projects/${projectId}`,
      headers: adam,
    });
    expect(deleted.status).toBe(204);
    const after = await call("GET", "/surveys", { headers: bearer(value) });
    expect(after.status).toBe(401);
    expect(await codeOf(after)).toBe("unauthenticated");
  });
});

describe.skipIf(sandbox)("legacy access keys", () => {
  it("lists the key by its last four, and the key acts as its owner", async (ctx) => {
    const legacyKey = await legacyKeyOrSkip(ctx);
    const olivia = await as(ctx, owner);
    expect(legacyKey).toEqual({
      lastFour: LEGACY_KEYS.owner.slice(-4),
      revocable: (await features()).legacyKeyRevoke,
    });
    const survey = await createdSurvey(olivia, olivia);
    const key = bearer(LEGACY_KEYS.owner);
    // Personal without `project`, as for a session; the letter case does not count.
    expect(await surveyIds(key)).toContain(survey.id);
    expect(await surveyIds(bearer(LEGACY_KEYS.owner.toUpperCase()))).toContain(survey.id);
    const got = await call("GET", "/surveys/{surveyId}", {
      path: `/surveys/${survey.id}`,
      headers: key,
    });
    expect(got.status).toBe(200);
  });

  it("refuses the key of a blocked owner", async (ctx) => {
    await legacyKeyOrSkip(ctx);
    const response = await call("GET", "/surveys", { headers: bearer(LEGACY_KEYS.blocked) });
    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("unauthenticated");
  });

  it("cannot replace a legacy key", async (ctx) => {
    await legacyKeyOrSkip(ctx);
    const response = await replace(bearer(LEGACY_KEYS.owner));
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe("legacy-key-replace-unavailable");
    expect(await surveysStatus(bearer(LEGACY_KEYS.owner))).toBe(200);
  });

  it("revokes the key only where the instance turned revocation on", async (ctx) => {
    await legacyKeyOrSkip(ctx);
    if (!(await features()).legacyKeyRevoke) {
      const olivia = await as(ctx, owner);
      const refused = await call("DELETE", "/api-tokens/legacy-key", { headers: olivia });
      expect(refused.status).toBe(409);
      expect(await codeOf(refused)).toBe("legacy-key-revoke-unavailable");
      expect(await surveysStatus(bearer(LEGACY_KEYS.owner))).toBe(200);
      return;
    }
    const oscar = await as(ctx, outsider);
    const key = bearer(LEGACY_KEYS.outsider);
    expect(await surveysStatus(key)).toBe(200);
    expect((await listed(oscar)).legacyKey).toEqual({
      lastFour: LEGACY_KEYS.outsider.slice(-4),
      revocable: true,
    });
    const revoked = await call("DELETE", "/api-tokens/legacy-key", { headers: oscar });
    expect(revoked.status).toBe(204);
    expect(await surveysStatus(key)).toBe(401);
    expect((await listed(oscar)).legacyKey).toBeNull();
    const again = await call("DELETE", "/api-tokens/legacy-key", { headers: oscar });
    expect(again.status).toBe(404);
  });
});
