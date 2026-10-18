import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { signIn } from "../auth/testing.js";
import { loadConfig } from "../config.js";
import type { SurveyRecord } from "../domain/types.js";
import { createProviders } from "../providers/index.js";
import {
  ResponseTooLargeError,
  type FileStore,
  type ProviderSet,
  type ResultStore,
} from "../providers/types.js";

const NOW = "2026-10-15T08:30:00.000Z";
const OWNER = "aaaaaaaa-0000-4000-8000-000000000001";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

interface Started {
  readonly server: FastifyInstance;
  readonly providers: ProviderSet;
  /** Creates a published survey with the definition and settings. */
  readonly publish: (
    definition: Record<string, unknown>,
    settings?: { storeRespondentIp?: boolean },
  ) => Promise<SurveyRecord>;
}

async function start(
  options: {
    env?: Record<string, string>;
    results?: (store: ResultStore) => ResultStore;
    files?: (store: FileStore) => FileStore;
    logLines?: string[];
  } = {},
): Promise<Started> {
  const config = loadConfig({
    NODE_ENV: "test",
    IDENTITY_PROVIDER: "dev",
    MEMORY_SEED: "legacy-fixtures",
    LOG_LEVEL: "info",
    ...options.env,
  });
  const memory = await createProviders(config);
  const providers: ProviderSet = {
    ...memory,
    results: options.results ? options.results(memory.results) : memory.results,
    files: options.files ? options.files(memory.files) : memory.files,
  };
  const { logLines } = options;
  const server = await buildApp(config, providers, {
    now: () => Date.parse(NOW),
    ...(logLines && { logStream: { write: (line: string) => logLines.push(line) } }),
  });
  app = server;
  const publish: Started["publish"] = async (definition, settings) => {
    const id = randomUUID();
    await providers.surveys.createSurvey(
      {
        id,
        name: "Own poll",
        owner: { kind: "personal", userId: OWNER },
        creatorId: OWNER,
        postId: randomUUID(),
        resultId: randomUUID(),
        createdAt: NOW,
        updatedAt: NOW,
      },
      definition,
    );
    const updated = await providers.surveys.updateSurvey(id, {
      published: true,
      ...(settings && { settings }),
      updatedAt: NOW,
    });
    return updated!;
  };
  return { server, providers, publish };
}

const submit = (
  server: FastifyInstance,
  survey: SurveyRecord,
  body: unknown,
  extra: { remoteAddress?: string; headers?: Record<string, string> } = {},
) =>
  server.inject({
    method: "POST",
    url: `/api/v1/public/surveys/${survey.id}/responses`,
    payload: body as object,
    ...extra,
  });

describe("submitResponse respondent address", () => {
  it("stores the address and the clock's time when the survey keeps addresses", async () => {
    const { server, providers, publish } = await start();
    const survey = await publish({}, { storeRespondentIp: true });
    const res = await submit(
      server,
      survey,
      { data: { q1: "a" } },
      { remoteAddress: "203.0.113.9" },
    );
    expect(res.statusCode).toBe(201);
    const [stored] = await providers.results.listResponses(survey);
    expect(stored).toMatchObject({
      id: res.json<{ id: string }>().id,
      respondentIp: "203.0.113.9",
      submittedAt: NOW,
    });
  });

  it("ignores X-Forwarded-For unless the peer is a trusted proxy", async () => {
    const headers = { "x-forwarded-for": "198.51.100.1" };
    const plain = await start();
    const survey = await plain.publish({}, { storeRespondentIp: true });
    await submit(plain.server, survey, { data: {} }, { remoteAddress: "203.0.113.9", headers });
    expect((await plain.providers.results.listResponses(survey))[0]?.respondentIp).toBe(
      "203.0.113.9",
    );
    await app?.close();

    const trusting = await start({ env: { TRUST_PROXY: "203.0.113.9" } });
    const other = await trusting.publish({}, { storeRespondentIp: true });
    await submit(trusting.server, other, { data: {} }, { remoteAddress: "203.0.113.9", headers });
    expect((await trusting.providers.results.listResponses(other))[0]?.respondentIp).toBe(
      "198.51.100.1",
    );
  });

  it("stores an IPv4-mapped address as plain IPv4", async () => {
    const { server, providers, publish } = await start();
    const survey = await publish({}, { storeRespondentIp: true });
    await submit(server, survey, { data: {} }, { remoteAddress: "::ffff:203.0.113.9" });
    expect((await providers.results.listResponses(survey))[0]?.respondentIp).toBe("203.0.113.9");
  });

  it("stores no address when the survey does not keep addresses", async () => {
    const { server, providers, publish } = await start();
    const survey = await publish({});
    await submit(server, survey, { data: {} }, { remoteAddress: "203.0.113.9" });
    const [stored] = await providers.results.listResponses(survey);
    expect(stored).toBeDefined();
    expect(stored).not.toHaveProperty("respondentIp");
  });
});

describe("submitResponse", () => {
  it("stores a partial response as complete", async () => {
    const { server, providers, publish } = await start();
    const survey = await publish({});
    const res = await submit(server, survey, {
      data: { q1: "a" },
      partial: true,
      lastPageIndex: 3,
    });
    expect(res.statusCode).toBe(201);
    expect((await providers.results.listResponses(survey))[0]).toMatchObject({ partial: false });
  });

  it("answers 413 when the store cannot hold the answers", async () => {
    const { server, publish } = await start({
      results: (store) => ({
        ...store,
        appendResponse: () => Promise.reject(new ResponseTooLargeError(40000, 32768)),
      }),
    });
    const survey = await publish({});
    const res = await submit(server, survey, { data: { q1: "a" } });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({
      code: "payload-too-large",
      detail: "The answers are too large to store.",
    });
  });

  it("answers 500 for another store failure and logs neither answers nor client id", async () => {
    const logLines: string[] = [];
    const { server, publish } = await start({
      logLines,
      results: (store) => ({
        ...store,
        appendResponse: () => Promise.reject(new Error("boom")),
      }),
    });
    const survey = await publish({});
    const res = await submit(server, survey, {
      data: { q1: "secret-answer" },
      clientId: "secret-client",
    });
    expect(res.statusCode).toBe(500);
    // The failure is logged, so the absence checks below look at a real error line.
    expect(logLines.some((line) => line.includes("boom"))).toBe(true);
    expect(logLines.join("\n")).not.toContain("secret-answer");
    expect(logLines.join("\n")).not.toContain("secret-client");
  });

  it("answers a replay with the first id and refuses a new key once the client has completed", async () => {
    const { server, publish } = await start();
    const survey = await publish({ cookieName: "limit" });
    const send = (key: string) =>
      submit(
        server,
        survey,
        { data: { q1: "a" }, clientId: "client-1" },
        { headers: { "idempotency-key": key } },
      );
    const first = await send("k1");
    expect(first.statusCode).toBe(201);
    const replay = await send("k1");
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toStrictEqual(first.json());
    const second = await send("k2");
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      code: "already-completed",
      title: "Already completed",
      detail:
        "This survey accepts one response per respondent, and this one has already completed it.",
    });
  });
});

describe("listResults page size and cursor", () => {
  const OLIVIA = "11111111-0000-4000-8000-a00000000001";
  const FEEDBACK = "22222222-0000-4000-8000-a00000000001";
  const LARGE = "22222222-0000-4000-8000-a00000000008";

  async function list(query: string, surveyId = LARGE) {
    const { server } = await start();
    const { headers } = await signIn(server, OLIVIA);
    return server.inject({
      url: `/api/v1/surveys/${surveyId}/results${query}`,
      headers,
    });
  }

  it("serves 500 items and a cursor without a limit", async () => {
    const res = await list("");
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: unknown[]; nextCursor: string | null }>();
    expect(body.items).toHaveLength(500);
    expect(body.nextCursor).toEqual(expect.any(String));
  });

  it.each([
    [1000, 1000],
    [1, 1],
  ])("serves limit=%i as %i items", async (limit, count) => {
    const res = await list(`?limit=${limit}`);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ items: unknown[] }>().items).toHaveLength(count);
  });

  it.each(["0", "1001", "1.5", "abc"])("refuses limit=%s with 400 at /limit", async (limit) => {
    const res = await list(`?limit=${limit}`);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "bad-request", errors: [{ pointer: "/limit" }] });
  });

  it("refuses a cursor of another survey", async () => {
    const { server } = await start();
    const { headers } = await signIn(server, OLIVIA);
    const first = await server.inject({
      url: `/api/v1/surveys/${FEEDBACK}/results?limit=1`,
      headers,
    });
    const { nextCursor } = first.json<{ nextCursor: string }>();
    const res = await server.inject({
      url: `/api/v1/surveys/${LARGE}/results?cursor=${nextCursor}`,
      headers,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "bad-request", detail: "Invalid cursor." });
  });
});

describe("exportResults, deleteResults and getPublicResults", () => {
  const OLIVIA = "11111111-0000-4000-8000-a00000000001";
  const FEEDBACK = "22222222-0000-4000-8000-a00000000001";

  it("sends the export as a no-store, nosniff attachment of the negotiated type", async () => {
    const { server } = await start();
    const { headers } = await signIn(server, OLIVIA);
    const json = await server.inject({
      url: `/api/v1/surveys/${FEEDBACK}/results/export`,
      headers,
    });
    expect(json.statusCode).toBe(200);
    expect(json.headers["cache-control"]).toBe("no-store");
    expect(json.headers["x-content-type-options"]).toBe("nosniff");
    expect(json.headers["content-type"]).toBe("application/json; charset=utf-8");
    const csv = await server.inject({
      url: `/api/v1/surveys/${FEEDBACK}/results/export?format=csv`,
      headers,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(csv.headers["cache-control"]).toBe("no-store");
  });

  it("answers 500 when the first page cannot be read, and logs no answer", async () => {
    const logLines: string[] = [];
    const { server } = await start({
      logLines,
      results: (store) => ({
        ...store,
        listResponsePage: () => Promise.reject(new Error("store down")),
      }),
    });
    const { headers } = await signIn(server, OLIVIA);
    const stored = await server.inject({
      method: "POST",
      url: `/api/v1/public/surveys/${FEEDBACK}/responses`,
      payload: { data: { satisfaction: "secret-answer" } },
    });
    expect(stored.statusCode).toBe(201);
    const res = await server.inject({ url: `/api/v1/surveys/${FEEDBACK}/results/export`, headers });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: "internal-error", status: 500 });
    expect(logLines.some((line) => line.includes("store down"))).toBe(true);
    expect(logLines.join("\n")).not.toContain("secret-answer");
  });

  it("answers 500 and keeps the responses when the respondent files cannot be deleted", async () => {
    const { server } = await start({
      files: (store) => ({
        ...store,
        deleteSurveyFiles: () => Promise.reject(new Error("files down")),
      }),
    });
    const { headers } = await signIn(server, OLIVIA);
    const stats = () =>
      server.inject({ url: `/api/v1/surveys/${FEEDBACK}/results/stats`, headers });
    const before = (await stats()).json();
    const res = await server.inject({
      method: "DELETE",
      url: `/api/v1/surveys/${FEEDBACK}/results`,
      headers,
    });
    expect(res.statusCode).toBe(500);
    expect((await stats()).json()).toStrictEqual(before);
  });

  it("serves public results as no-store, without the private question", async () => {
    const { server } = await start();
    const res = await server.inject({ url: `/api/v1/public/surveys/${FEEDBACK}/results` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json<{ items: { data: Record<string, unknown> }[] }>();
    expect(body.items).toHaveLength(5);
    for (const item of body.items) expect(item.data).not.toHaveProperty("receipt");
  });
});
