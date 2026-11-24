import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { SESSION_COOKIE } from "../auth/cookies.js";
import { createSession, encodeSession } from "../auth/session.js";
import { signIn } from "../auth/testing.js";
import { loadConfig } from "../config.js";
import { createProviders } from "../providers/index.js";
import { ERASABLE_ID, UNKNOWN_ID } from "../providers/suite/expected.js";
import type { LocalAccountStore, ProviderSet } from "../providers/types.js";
import { signWebhook } from "./webhook.js";
import { webhookKey } from "./webhook-secret.js";

// The Standard Webhooks test vector's secret (synthetic).
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const KEY = webhookKey(SECRET);
const NOW_MS = Date.parse("2026-10-19T10:00:00.000Z");
const NOW_SECONDS = NOW_MS / 1000;
const WEBHOOK_URL = "/api/v1/webhooks/account-deleted";
const WEBHOOK_ID = "msg_handlers-test";
const ERASABLE_EMAIL = "erasable@example.com";

const deleted = (userId: unknown) => JSON.stringify({ type: "account.deleted", data: { userId } });

const invalidSignature = {
  type: "https://studio.surveyjs.io/problems/invalid-signature",
  code: "invalid-signature",
  status: 401,
  title: "Invalid signature",
  detail: "The webhook signature is missing, wrong or too old.",
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** The app on memory with the legacy fixtures, its clock at NOW_MS, its log lines in `lines`. */
async function start(env: Record<string, string> = { ACCOUNT_WEBHOOK_SECRET: SECRET }) {
  const config = loadConfig({
    NODE_ENV: "test",
    IDENTITY_PROVIDER: "dev",
    MEMORY_SEED: "legacy-fixtures",
    ...env,
  });
  const lines: string[] = [];
  app = await buildApp(config, await createProviders(config), {
    now: () => NOW_MS,
    logStream: { write: (line) => lines.push(line) },
  });
  return { server: app, lines };
}

interface Delivery {
  readonly body: string;
  readonly key?: Buffer;
  readonly timestamp?: number;
  readonly headers?: Record<string, string>;
}

/** Posts `body` signed with `key` (default: the configured one) as JSON. */
function deliver(server: FastifyInstance, delivery: Delivery) {
  const { body, key = KEY, timestamp = NOW_SECONDS, headers = {} } = delivery;
  return server.inject({
    method: "POST",
    url: WEBHOOK_URL,
    headers: {
      "content-type": "application/json",
      ...signWebhook(key, WEBHOOK_ID, timestamp, body),
      ...headers,
    },
    payload: body,
  });
}

/** Erin's new personal survey, created over the API; returns a function that reads it as Erin. */
async function erinsSurvey(server: FastifyInstance) {
  const { headers } = await signIn(server, ERASABLE_ID);
  const created = await server.inject({
    method: "POST",
    url: "/api/v1/surveys",
    headers,
    payload: { name: "Erin's survey" },
  });
  expect(created.statusCode).toBe(201);
  const id = created.json<{ id: string }>().id;
  return () => server.inject({ url: `/api/v1/surveys/${id}`, headers });
}

describe("receiveAccountDeleted: refusals", () => {
  it("answers 404 when no webhook secret is configured", async () => {
    const { server } = await start({});
    const res = await deliver(server, { body: deleted(ERASABLE_ID) });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "not-found", status: 404, title: "Not found" });
  });

  it("answers 401 invalid-signature without the headers", async () => {
    const { server } = await start();
    const res = await server.inject({
      method: "POST",
      url: WEBHOOK_URL,
      headers: { "content-type": "application/json" },
      payload: deleted(ERASABLE_ID),
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toStrictEqual(invalidSignature);
  });

  it("answers 401 for a signature made with another secret", async () => {
    const { server } = await start();
    const res = await deliver(server, { body: deleted(ERASABLE_ID), key: randomBytes(32) });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toStrictEqual(invalidSignature);
  });

  it("answers 401 for a stale timestamp", async () => {
    const { server } = await start();
    const res = await deliver(server, { body: deleted(ERASABLE_ID), timestamp: NOW_SECONDS - 600 });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toStrictEqual(invalidSignature);
  });

  it("checks the signature before the body: a wrong one with an invalid body is 401", async () => {
    const { server } = await start();
    const res = await deliver(server, { body: "{", key: randomBytes(32) });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toStrictEqual(invalidSignature);
  });

  it("answers 401 for a wrong signature without a content type", async () => {
    const { server } = await start();
    const body = deleted(ERASABLE_ID);
    const res = await server.inject({
      method: "POST",
      url: WEBHOOK_URL,
      headers: signWebhook(randomBytes(32), WEBHOOK_ID, NOW_SECONDS, body),
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toStrictEqual(invalidSignature);
  });

  it("answers 400 for a signed body that is not JSON", async () => {
    const { server } = await start();
    const res = await deliver(server, { body: "{" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: "bad-request",
      status: 400,
      title: "Bad request",
      detail: "The body must be an account event.",
    });
  });

  it("answers 400 for a signed account.deleted event without a user id", async () => {
    const { server } = await start();
    const res = await deliver(server, { body: '{"type":"account.deleted","data":{}}' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: "bad-request",
      status: 400,
      title: "Bad request",
      detail: "data.userId must be a user ID.",
    });
  });

  it("answers 413 for a body over 64 KiB, before the signature check", async () => {
    const { server } = await start();
    const body = JSON.stringify({ type: "account.deleted", pad: "x".repeat(65_536) });
    const res = await deliver(server, { body });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: "payload-too-large" });
  });

  it("logs the webhook id and the reason of a refusal, never the signature, body or email", async () => {
    const { server, lines } = await start();
    const body = deleted(ERASABLE_ID).replace("}}", `,"email":"${ERASABLE_EMAIL}"}}`);
    const signed = signWebhook(randomBytes(32), WEBHOOK_ID, NOW_SECONDS, body);
    const stale = signWebhook(KEY, WEBHOOK_ID, NOW_SECONDS - 600, body);
    await deliver(server, { body, key: randomBytes(32) });
    await deliver(server, { body, timestamp: NOW_SECONDS - 600 });
    await deliver(server, { body, headers: { "webhook-id": "bad id with spaces" } });

    const refusals = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === "Refused an account-deleted webhook.");
    expect(refusals.map((entry) => [entry.webhookId, entry.reason])).toEqual([
      [WEBHOOK_ID, "bad-signature"],
      [WEBHOOK_ID, "stale"],
      ["(invalid)", "bad-signature"],
    ]);
    const log = lines.join("\n");
    expect(log).not.toContain(signed["webhook-signature"]!.slice(3));
    expect(log).not.toContain(stale["webhook-signature"]!.slice(3));
    expect(log).not.toContain(ERASABLE_EMAIL);
    expect(log).not.toContain("account.deleted");
    expect(log).not.toContain(SECRET);
  });
});

describe("receiveAccountDeleted: events", () => {
  it("ignores an event of another type", async () => {
    const { server } = await start();
    const read = await erinsSurvey(server);
    const body = JSON.stringify({ type: "account.created", data: { userId: ERASABLE_ID } });
    const res = await deliver(server, { body });
    expect(res.statusCode).toBe(204);
    expect((await read()).statusCode).toBe(200);
  });

  it("erases the account of an account.deleted event, and a repeat is harmless", async () => {
    const { server } = await start();
    const read = await erinsSurvey(server);

    const first = await deliver(server, { body: deleted(ERASABLE_ID) });
    expect(first.statusCode).toBe(204);
    expect(first.body).toBe("");
    expect((await read()).statusCode).toBe(404);

    const again = await deliver(server, { body: deleted(ERASABLE_ID) });
    expect(again.statusCode).toBe(204);
  });
});

describe("receiveAccountDeleted: hosted accounts (ADR 0043)", () => {
  const SESSION_SECRET = "a-test-only-session-secret-of-32-chars-or-more";
  // The surveyjs.io id of an account an admin created with another id (synthetic).
  const SITE_ID = "11111111-0000-4000-8000-000000000042";
  const CREATED_AT = new Date(NOW_MS - 86_400_000).toISOString();
  const HOSTED = {
    APP_EDITION: "hosted",
    USER_DIRECTORY: "local",
    AUTH_METHODS: "surveyjs",
    OIDC_ISSUER_URL: "https://auth.example.com",
    OIDC_CLIENT_ID: "s-client",
    OIDC_CLIENT_SECRET: "test-only-oidc-secret",
    ADMIN_EMAIL: "admin@example.com",
    ACCOUNT_WEBHOOK_SECRET: SECRET,
  };
  /** USER_DIRECTORY=local without APP_EDITION=hosted: the self-hosted edition. */
  const SELF_HOSTED = {
    USER_DIRECTORY: "local",
    AUTH_METHODS: "password",
    ADMIN_EMAIL: "admin@example.com",
    ADMIN_PASSWORD: "first admin password",
    ACCOUNT_WEBHOOK_SECRET: SECRET,
  };

  /** Empty memory with local accounts; `build` starts the app on them. */
  async function startLocal(env: Record<string, string>) {
    const config = loadConfig({
      NODE_ENV: "test",
      PUBLIC_BASE_URL: "https://studio.example.com",
      SESSION_SECRET,
      ...env,
    });
    const providers = await createProviders(config);
    const accounts = providers.accounts!;
    const lines: string[] = [];
    const build = async () => {
      app = await buildApp(config, providers, {
        now: () => NOW_MS,
        logStream: { write: (line) => lines.push(line) },
      });
      return app;
    };
    return { build, providers, accounts, lines };
  }

  /** A local account for Erin, with a `surveyjs` identity whose subject is `subject` when given. */
  async function seedErin(
    accounts: LocalAccountStore,
    { subject, instanceRole = "user" }: { subject?: string; instanceRole?: "admin" | "user" } = {},
  ) {
    await accounts.createAccount({
      id: ERASABLE_ID,
      email: ERASABLE_EMAIL,
      displayName: "Erin Erasable",
      instanceRole,
      status: "active",
      passwordHash: null,
      mustChangePassword: false,
      createdAt: CREATED_AT,
    });
    if (subject !== undefined) {
      const linked = await accounts.linkIdentity({
        provider: "surveyjs",
        subject,
        userId: ERASABLE_ID,
        email: ERASABLE_EMAIL,
        emailVerified: true,
        createdAt: CREATED_AT,
      });
      expect(linked).toBe("linked");
    }
  }

  /** A personal survey of `userId`, stored directly; returns a function that lists its surveys. */
  async function personalSurvey(providers: ProviderSet, userId: string, n: 1 | 2) {
    await providers.surveys.createSurvey({
      id: `eeeeeeee-0000-4000-8000-0000000000${n}1`,
      name: "A personal survey",
      owner: { kind: "personal", userId },
      creatorId: userId,
      postId: `eeeeeeee-0000-4000-8000-0000000000${n}2`,
      resultId: `eeeeeeee-0000-4000-8000-0000000000${n}3`,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    const surveys = () => providers.surveys.listSurveyIds({ kind: "personal", userId });
    expect(await surveys()).toHaveLength(1);
    return surveys;
  }

  /** A personal survey of Erin; returns a function that lists Erin's surveys. */
  const erinsData = (providers: ProviderSet) => personalSurvey(providers, ERASABLE_ID, 1);

  const logEntries = (lines: readonly string[]) =>
    lines.map((line) => JSON.parse(line) as Record<string, unknown>);

  it("erases the data and deletes the account whose id is the surveyjs.io id, with its identities", async () => {
    const { build, providers, accounts, lines } = await startLocal(HOSTED);
    await seedErin(accounts, { subject: ERASABLE_ID });
    const surveys = await erinsData(providers);
    const server = await build();

    const res = await deliver(server, { body: deleted(ERASABLE_ID.toUpperCase()) });

    expect(res.statusCode).toBe(204);
    expect(await surveys()).toEqual([]);
    expect(await accounts.account(ERASABLE_ID)).toBeNull();
    expect(await accounts.listIdentities(ERASABLE_ID)).toEqual([]);
    expect(await accounts.accountByIdentity("surveyjs", ERASABLE_ID)).toBeNull();
    expect(lines.join("\n")).not.toContain(ERASABLE_EMAIL);
  });

  it("finds an account an admin created with another id by its surveyjs identity (Review Focus 3)", async () => {
    const { build, providers, accounts, lines } = await startLocal(HOSTED);
    await seedErin(accounts, { subject: SITE_ID });
    const surveys = await erinsData(providers);
    // Data under the surveyjs.io id itself (legacy rows) is the same person's.
    const siteSurveys = await personalSurvey(providers, SITE_ID, 2);
    const server = await build();

    const res = await deliver(server, { body: deleted(SITE_ID.toUpperCase()) });

    expect(res.statusCode).toBe(204);
    expect(await surveys()).toEqual([]);
    expect(await siteSurveys()).toEqual([]);
    expect(await accounts.account(ERASABLE_ID)).toBeNull();
    expect(await accounts.accountByIdentity("surveyjs", SITE_ID)).toBeNull();
    const erased = logEntries(lines).filter((e) => e.msg === "Erased the data of an account.");
    expect(erased.map((e) => e.userId)).toEqual([ERASABLE_ID, SITE_ID]);
  });

  it("finds an account by its id when no identity names the surveyjs.io id", async () => {
    const { build, providers, accounts, lines } = await startLocal(HOSTED);
    await seedErin(accounts);
    const surveys = await erinsData(providers);
    const server = await build();

    const res = await deliver(server, { body: deleted(ERASABLE_ID) });

    expect(res.statusCode).toBe(204);
    expect(await surveys()).toEqual([]);
    expect(await accounts.account(ERASABLE_ID)).toBeNull();
    // One erasure: the account's id is the surveyjs.io id.
    const erased = logEntries(lines).filter((e) => e.msg === "Erased the data of an account.");
    expect(erased.map((e) => e.userId)).toEqual([ERASABLE_ID]);
  });

  it("acknowledges an id Studio does not know with 204, and changes nothing (Review Focus 3)", async () => {
    const { build, providers, accounts } = await startLocal(HOSTED);
    await seedErin(accounts, { subject: SITE_ID });
    const surveys = await erinsData(providers);
    const server = await build();
    const before = await accounts.account(ERASABLE_ID);

    const res = await deliver(server, { body: deleted(UNKNOWN_ID) });

    expect(res.statusCode).toBe(204);
    expect(await surveys()).toHaveLength(1);
    expect(await accounts.account(ERASABLE_ID)).toEqual(before);
    expect(await accounts.accountByIdentity("surveyjs", SITE_ID)).toMatchObject({
      user: { id: ERASABLE_ID },
    });
    expect(await accounts.countAccounts()).toBe(1);
  });

  it("deletes the last instance admin too, warning with the id only", async () => {
    const { build, providers, accounts, lines } = await startLocal(HOSTED);
    await seedErin(accounts, { subject: ERASABLE_ID, instanceRole: "admin" });
    const surveys = await erinsData(providers);
    const server = await build();

    const res = await deliver(server, { body: deleted(ERASABLE_ID) });

    expect(res.statusCode).toBe(204);
    expect(await surveys()).toEqual([]);
    expect(await accounts.account(ERASABLE_ID)).toBeNull();
    expect(await accounts.listIdentities(ERASABLE_ID)).toEqual([]);
    expect(await accounts.accountByIdentity("surveyjs", ERASABLE_ID)).toBeNull();
    // No active admin is left, so ADMIN_EMAIL is made admin at its next sign-in.
    expect(await accounts.countActiveAdmins()).toBe(0);
    const warnings = logEntries(lines).filter((e) => e.level === 40);
    expect(warnings).toEqual([
      expect.objectContaining({
        userId: ERASABLE_ID,
        msg: "the deleted surveyjs.io account was the last instance admin: ADMIN_EMAIL is made admin at its next sign-in",
      }),
    ]);
    expect(lines.join("\n")).not.toContain(ERASABLE_EMAIL);
  });

  it("deletes an admin who is not the last one without a warning", async () => {
    const { build, providers, accounts, lines } = await startLocal(HOSTED);
    await seedErin(accounts, { subject: ERASABLE_ID, instanceRole: "admin" });
    await accounts.createAccount({
      id: UNKNOWN_ID,
      email: "other-admin@example.com",
      displayName: "Other Admin",
      instanceRole: "admin",
      status: "active",
      passwordHash: null,
      mustChangePassword: false,
      createdAt: CREATED_AT,
    });
    await erinsData(providers);
    const server = await build();

    expect((await deliver(server, { body: deleted(ERASABLE_ID) })).statusCode).toBe(204);

    expect(await accounts.account(ERASABLE_ID)).toBeNull();
    expect(await accounts.countActiveAdmins()).toBe(1);
    expect(logEntries(lines).filter((e) => e.level === 40)).toEqual([]);
  });

  it("ends the deleted account's sessions at once on this server", async () => {
    const { build, accounts } = await startLocal(HOSTED);
    await seedErin(accounts, { subject: ERASABLE_ID });
    const server = await build();
    const csrf = "a-test-csrf-token";
    const session = createSession(
      { sub: ERASABLE_ID, name: "Erin Erasable", email: ERASABLE_EMAIL, avatarUrl: null },
      csrf,
      3600,
      () => NOW_MS,
      (await accounts.account(ERASABLE_ID))!.sessionEpoch,
    );
    const me = () =>
      server.inject({
        url: "/api/v1/me",
        headers: { cookie: `${SESSION_COOKIE}=${encodeSession(SESSION_SECRET, session)}` },
      });
    // The session check now holds the account; the clock does not move, so only `forget` clears it.
    expect((await me()).statusCode).toBe(200);

    expect((await deliver(server, { body: deleted(ERASABLE_ID) })).statusCode).toBe(204);

    expect((await me()).statusCode).toBe(401);
  });

  it("answers 500 when the account store fails, so the site retries", async () => {
    const { build, providers, accounts } = await startLocal(HOSTED);
    await seedErin(accounts, { subject: ERASABLE_ID });
    await erinsData(providers);
    vi.spyOn(accounts, "deleteAccount").mockRejectedValue(new Error("the store is down"));
    const server = await build();

    const res = await deliver(server, { body: deleted(ERASABLE_ID) });

    expect(res.statusCode).toBe(500);
    // Disabled before the erasure: it can no longer sign in, and a retry finishes the delete.
    expect(await accounts.account(ERASABLE_ID)).toMatchObject({ status: "disabled" });
  });

  it("keeps today's behaviour without APP_EDITION=hosted: the data is erased, the account stays", async () => {
    const { build, providers, accounts } = await startLocal(SELF_HOSTED);
    await seedErin(accounts, { subject: ERASABLE_ID });
    const surveys = await erinsData(providers);
    const server = await build();

    const res = await deliver(server, { body: deleted(ERASABLE_ID) });

    expect(res.statusCode).toBe(204);
    expect(await surveys()).toEqual([]);
    expect(await accounts.account(ERASABLE_ID)).toMatchObject({ status: "active" });
  });
});
