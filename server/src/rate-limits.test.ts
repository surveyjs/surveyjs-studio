import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createProviders } from "./providers/index.js";

const SURVEY = "22222222-0000-4000-8000-a00000000001";
const SURVEY_URL = `/api/v1/public/surveys/${SURVEY}`;

let app: FastifyInstance | undefined;

async function start(env: Record<string, string> = {}): Promise<FastifyInstance> {
  const config = loadConfig({
    NODE_ENV: "test",
    IDENTITY_PROVIDER: "dev",
    MEMORY_SEED: "legacy-fixtures",
    PUBLIC_RATE_LIMIT: "2",
    PUBLIC_FILE_RATE_LIMIT: "1",
    ...env,
  });
  app = await buildApp(config, await createProviders(config));
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("public rate limits", () => {
  it("limits each public operation per address, before the operation runs", async () => {
    const server = await start();
    const get = (remoteAddress: string) => server.inject({ url: SURVEY_URL, remoteAddress });
    for (let i = 0; i < 2; i += 1) expect((await get("203.0.113.9")).statusCode).toBe(501);
    const res = await get("203.0.113.9");
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(res.json()).toMatchObject({
      code: "rate-limited",
      status: 429,
      title: "Too many requests",
    });
    expect(res.json<{ detail: string }>().detail).toMatch(/^Too many requests\. Try again in /);

    const post = await server.inject({
      method: "POST",
      url: `${SURVEY_URL}/responses`,
      remoteAddress: "203.0.113.9",
      payload: { data: {} },
    });
    expect(post.statusCode).not.toBe(429);
    expect((await get("203.0.113.10")).statusCode).toBe(501);
  });

  it("limits downloadFile on its own counter", async () => {
    const server = await start();
    const url = "/api/v1/public/files/99999999-0000-4000-8000-a00000000099";
    expect((await server.inject({ url, remoteAddress: "203.0.113.9" })).statusCode).toBe(404);
    expect((await server.inject({ url, remoteAddress: "203.0.113.9" })).statusCode).toBe(429);
  });

  it("keys on X-Forwarded-For only from a trusted proxy", async () => {
    const trusting = await start({ TRUST_PROXY: "127.0.0.1" });
    const via = (forwarded: string) =>
      trusting.inject({
        url: SURVEY_URL,
        remoteAddress: "127.0.0.1",
        headers: { "x-forwarded-for": forwarded },
      });
    for (const forwarded of ["198.51.100.1", "198.51.100.2"]) {
      for (let i = 0; i < 2; i += 1) expect((await via(forwarded)).statusCode).toBe(501);
    }
    expect((await via("198.51.100.1")).statusCode).toBe(429);
    await app?.close();

    const plain = await start();
    const direct = (forwarded: string) =>
      plain.inject({
        url: SURVEY_URL,
        remoteAddress: "127.0.0.1",
        headers: { "x-forwarded-for": forwarded },
      });
    expect((await direct("198.51.100.1")).statusCode).toBe(501);
    expect((await direct("198.51.100.2")).statusCode).toBe(501);
    expect((await direct("198.51.100.3")).statusCode).toBe(429);
  });
});
