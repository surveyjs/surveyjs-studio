import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { signIn } from "../auth/testing.js";
import { loadConfig } from "../config.js";
import { createProviders } from "../providers/index.js";
import type { ProviderSet } from "../providers/types.js";

const OLIVIA = "11111111-0000-4000-8000-a00000000001";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(wrap: (providers: ProviderSet) => ProviderSet, logLines: string[] = []) {
  const config = loadConfig({
    NODE_ENV: "test",
    IDENTITY_PROVIDER: "dev",
    MEMORY_SEED: "legacy-fixtures",
    LOG_LEVEL: "info",
  });
  const providers = wrap(await createProviders(config));
  const server = await buildApp(config, providers, {
    logStream: { write: (line: string) => logLines.push(line) },
  });
  app = server;
  const { headers } = await signIn(server, OLIVIA);
  // A survey of the test's own: no view is written to a fixture survey (R23).
  const created = await server.inject({
    method: "POST",
    url: "/api/v1/surveys",
    headers,
    payload: { name: "Views test" },
  });
  expect(created.statusCode).toBe(201);
  const surveyId = (created.json() as { id: string }).id;
  return { server, providers, headers, surveyId };
}

describe("saveResultsView", () => {
  it("answers 500 when the store fails and logs no layout text", async () => {
    const logLines: string[] = [];
    const { server, headers, surveyId } = await start(
      (providers) => ({
        ...providers,
        views: { ...providers.views, saveView: () => Promise.reject(new Error("boom")) },
      }),
      logLines,
    );
    const res = await server.inject({
      method: "PUT",
      url: `/api/v1/surveys/${surveyId}/views/summary`,
      headers,
      payload: { text: "secret-layout" },
    });
    expect(res.statusCode).toBe(500);
    expect(logLines.some((line) => line.includes("boom"))).toBe(true);
    expect(logLines.join("\n")).not.toContain("secret-layout");
  });

  it("leaves the survey record unchanged", async () => {
    const { server, providers, headers, surveyId } = await start((p) => p);
    const before = await providers.surveys.getSurvey(surveyId);
    const url = `/api/v1/surveys/${surveyId}/views/table`;
    expect(
      (await server.inject({ method: "PUT", url, headers, payload: { a: 1 } })).statusCode,
    ).toBe(204);
    expect((await server.inject({ method: "DELETE", url, headers })).statusCode).toBe(204);
    expect(await providers.surveys.getSurvey(surveyId)).toStrictEqual(before);
  });
});
