import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { signIn } from "../auth/testing.js";
import { loadConfig } from "../config.js";
import { createProviders } from "../providers/index.js";
import { ERASABLE_ID } from "../providers/suite/expected.js";
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
