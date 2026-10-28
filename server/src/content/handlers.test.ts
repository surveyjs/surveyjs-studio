import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createDevIdentityProvider } from "../auth/providers/dev.js";
import { signIn } from "../auth/testing.js";
import { loadConfig } from "../config.js";
import type { SurveyRecord, User } from "../domain/types.js";
import { createMemoryProviders, type MemorySeed } from "../providers/memory.js";

const NOW = "2026-10-15T08:30:00.000Z";
const USER: User = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  email: "user@example.com",
  displayName: "User",
  blocked: false,
};
const SURVEY_ID = "cccccccc-0000-4000-8000-000000000001";

const survey: SurveyRecord = {
  id: SURVEY_ID,
  name: "Poll",
  owner: { kind: "personal", userId: USER.id },
  creatorId: USER.id,
  postId: "dddddddd-0000-4000-8000-000000000001",
  resultId: "eeeeeeee-0000-4000-8000-000000000001",
  published: false,
  archived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
};

const seed: MemorySeed = { users: [USER], surveys: [survey], projects: [], memberships: [] };

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** The app on a memory store, its clock fixed at NOW, signed in as USER. */
async function start(env: Record<string, string> = {}) {
  const config = loadConfig({ NODE_ENV: "test", IDENTITY_PROVIDER: "dev", ...env });
  app = await buildApp(config, createMemoryProviders(seed), {
    identity: createDevIdentityProvider({ publicBaseUrl: config.publicBaseUrl, users: seed.users }),
    now: () => Date.parse(NOW),
  });
  const { headers } = await signIn(app, USER.id);
  return { server: app, headers };
}

const url = (part: string) => `/api/v1/surveys/${SURVEY_ID}/${part}`;

describe("reading a document", () => {
  // A compressing proxy rewrites the ETag of what it compresses (Caddy: `"v"` becomes `"v-zstd"`),
  // and the rewritten tag never matches on save.
  it.each(["definition", "theme"])("asks proxies not to transform the %s", async (part) => {
    const { server, headers } = await start();
    const res = await server.inject({ url: url(part), headers });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-transform");
  });
});

describe("saving a definition", () => {
  it("sets updatedAt to the clock's time", async () => {
    const { server, headers } = await start();
    const read = await server.inject({ url: url("definition"), headers });
    const save = await server.inject({
      method: "PUT",
      url: url("definition"),
      headers: { ...headers, "if-match": read.headers.etag as string },
      payload: { title: "Poll" },
    });
    expect(save.statusCode).toBe(204);
    const record = await server.inject({ url: `/api/v1/surveys/${SURVEY_ID}`, headers });
    expect(record.json<{ updatedAt: string }>().updatedAt).toBe(NOW);
  });

  it("answers 428 without If-Match", async () => {
    const { server, headers } = await start();
    const res = await server.inject({
      method: "PUT",
      url: url("definition"),
      headers,
      payload: { title: "Poll" },
    });
    expect(res.statusCode).toBe(428);
    expect(res.json()).toMatchObject({
      code: "if-match-required",
      title: "If-Match required",
      detail: "Send the ETag from your last read in If-Match.",
    });
  });

  it("answers 412 for a stale tag", async () => {
    const { server, headers } = await start();
    const res = await server.inject({
      method: "PUT",
      url: url("definition"),
      headers: { ...headers, "if-match": '"stale"' },
      payload: { title: "Poll" },
    });
    expect(res.statusCode).toBe(412);
    expect(res.json()).toMatchObject({
      code: "edit-conflict",
      title: "The survey was changed by someone else",
      detail: "Reload the survey to see the latest version.",
    });
  });
});

describe("the body limit", () => {
  it("rejects a definition over LIMIT_MAX_DOCUMENT_BYTES with 413", async () => {
    const { server, headers } = await start({ LIMIT_MAX_DOCUMENT_BYTES: "500" });
    const res = await server.inject({
      method: "PUT",
      url: url("definition"),
      headers: { ...headers, "if-match": "*" },
      payload: { title: "x".repeat(600) },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: "payload-too-large" });
  });

  it("rejects a theme over LIMIT_MAX_DOCUMENT_BYTES with 413", async () => {
    const { server, headers } = await start({ LIMIT_MAX_DOCUMENT_BYTES: "500" });
    const res = await server.inject({
      method: "PUT",
      url: url("theme"),
      headers: { ...headers, "if-match": "*" },
      payload: { cssVariables: { a: "x".repeat(600) } },
    });
    expect(res.statusCode).toBe(413);
  });

  it("saves a 2 MB definition with the default limit", async () => {
    const { server, headers } = await start();
    const res = await server.inject({
      method: "PUT",
      url: url("definition"),
      headers: { ...headers, "if-match": "*" },
      payload: { title: "x".repeat(2 * 1024 * 1024) },
    });
    expect(res.statusCode).toBe(204);
  });

  it("keeps the global limit on other JSON routes", async () => {
    const { server, headers } = await start();
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/surveys",
      headers,
      payload: { name: "x".repeat(2 * 1024 * 1024) },
    });
    expect(res.statusCode).toBe(413);
  });
});
