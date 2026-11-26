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
  type ResponsePageQuery,
  type ResultStore,
  type ViewStore,
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
    views?: (store: ViewStore) => ViewStore;
    logLines?: string[];
  } = {},
): Promise<Started> {
  const loaded = loadConfig({
    NODE_ENV: "test",
    IDENTITY_PROVIDER: "dev",
    MEMORY_SEED: "legacy-fixtures",
    LOG_LEVEL: "info",
    ...options.env,
  });
  // Hosted, which routes the bridge's operations (set after loading: the dev sign-in is refused
  // with APP_EDITION=hosted). api.test.ts checks they are not routed elsewhere.
  const config = { ...loaded, edition: "hosted" as const };
  const memory = await createProviders(config);
  const providers: ProviderSet = {
    ...memory,
    results: options.results ? options.results(memory.results) : memory.results,
    files: options.files ? options.files(memory.files) : memory.files,
    views: options.views ? options.views(memory.views) : memory.views,
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
  it("stores a partial response as complete when there is no client id", async () => {
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

  it("stores a partial save of a client as a partial row and does not store lastPageIndex", async () => {
    const { server, providers, publish } = await start();
    const survey = await publish({});
    const res = await submit(server, survey, {
      data: { q1: "a" },
      clientId: "c-1",
      partial: true,
      lastPageIndex: 2,
    });
    expect(res.statusCode).toBe(201);
    const [row] = await providers.results.listResponses(survey);
    expect(row).toMatchObject({ partial: true, clientId: "c-1" });
    expect(row).not.toHaveProperty("lastPageIndex");
    expect(await providers.results.completion(survey, "c-1")).toBe("partial");
  });

  it("refuses a negative lastPageIndex", async () => {
    const { server, publish } = await start();
    const survey = await publish({});
    const res = await submit(server, survey, { data: {}, clientId: "c-1", lastPageIndex: -1 });
    expect(res.statusCode).toBe(422);
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

  it("answers 500 for public results when the private-question list cannot be read", async () => {
    const logLines: string[] = [];
    const { server } = await start({
      logLines,
      views: (store) => ({
        ...store,
        getPrivateQuestions: () => Promise.reject(new Error("list unreadable")),
      }),
    });
    const stored = await server.inject({
      method: "POST",
      url: `/api/v1/public/surveys/${FEEDBACK}/responses`,
      payload: { data: { receipt: "secret-answer" } },
    });
    expect(stored.statusCode).toBe(201);
    const res = await server.inject({ url: `/api/v1/public/surveys/${FEEDBACK}/results` });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: "internal-error", status: 500 });
    expect(res.body).not.toContain("secret-answer");
    expect(logLines.join("\n")).not.toContain("secret-answer");
  });

  it("serves only the store's public keys when it names them: a layout-hidden question, a response-only key and the submit time stay out", async () => {
    // As the old stores answer with both old settings (ADR 0016, changed 2026-11-26).
    const privacy = {
      privateQuestions: ["q2", "q3", "HappendAt", "InstanceId"],
      publicOnly: ["q1", "q1-Comment"],
      lockedQuestions: ["q3"],
    };
    const { server, providers, publish } = await start({
      views: (store) => ({ ...store, getResultsPrivacy: () => Promise.resolve(privacy) }),
    });
    const survey = await publish({
      elements: [
        { type: "text", name: "q1", hasComment: true },
        { type: "text", name: "q2" },
        { type: "text", name: "q3" },
      ],
    });
    await providers.surveys.updateSurvey(survey.id, {
      settings: { publicResults: true },
      updatedAt: NOW,
    });
    const data = { q1: "a", "q1-Comment": "c", q2: "b", q3: "d", k: "response-only" };
    expect((await submit(server, survey, { data })).statusCode).toBe(201);

    const res = await server.inject({ url: `/api/v1/public/surveys/${survey.id}/results` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      survey: { privateQuestions: string[] };
      items: { data: Record<string, unknown> }[];
    }>();
    expect(body.items.map((item) => item.data)).toEqual([{ q1: "a", "q1-Comment": "c" }]);
    // A dashboard hides the submit time by this name; the bridge drops `HappendAt` by it too.
    expect(body.survey.privateQuestions).toEqual(privacy.privateQuestions);
  });

  it("serves public results as no-store, without the private question", async () => {
    const { server } = await start();
    const res = await server.inject({ url: `/api/v1/public/surveys/${FEEDBACK}/results` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json<{ items: { data: Record<string, unknown> }[] }>();
    expect(body.items).toHaveLength(4);
    for (const item of body.items) expect(item.data).not.toHaveProperty("receipt");
  });
});

describe("submitResponse partial saves", () => {
  const limited = { pages: [], cookieName: "limit-test" };

  it("lets a client with a partial marker post again, then refuses every post once complete", async () => {
    const { server, publish } = await start();
    const survey = await publish(limited);
    const post = (extra: object) =>
      submit(server, survey, { data: { q1: "a" }, clientId: "c-1", ...extra });
    expect((await post({ partial: true })).statusCode).toBe(201);
    expect((await post({ partial: true })).statusCode).toBe(201);
    expect((await post({})).statusCode).toBe(201);
    expect((await post({ partial: true })).statusCode).toBe(409);
    expect((await post({})).statusCode).toBe(409);
  });

  it("stores one row and answers the same id for a retried partial post", async () => {
    const { server, providers, publish } = await start();
    const survey = await publish({});
    const headers = { "idempotency-key": "retry-1" };
    const body = { data: { q1: "a" }, clientId: "c-1", partial: true };
    const first = await submit(server, survey, body, { headers });
    const again = await submit(server, survey, body, { headers });
    expect(again.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    expect(await providers.results.listResponses(survey)).toHaveLength(1);
  });
});

describe("submitResponseByPostId", () => {
  it("stores for an unpublished survey with the respondent address, and refuses an unknown post ID", async () => {
    const { server, providers, publish } = await start();
    const survey = await publish(
      { pages: [], cookieName: "limit-test" },
      { storeRespondentIp: true },
    );
    await providers.surveys.updateSurvey(survey.id, { published: false, updatedAt: NOW });
    const post = (postId: string, body: object) =>
      server.inject({
        method: "POST",
        url: `/api/v1/public/posts/${postId}/responses`,
        payload: body,
        remoteAddress: "203.0.113.9",
      });
    const body = { data: { q1: "a" }, clientId: "c-1" };
    expect((await post(survey.postId, body)).statusCode).toBe(201);
    expect((await post(survey.postId, body)).statusCode).toBe(201);
    const stored = await providers.results.listResponses(survey);
    expect(stored[0]).toMatchObject({ respondentIp: "203.0.113.9" });
    expect(await providers.results.completion(survey, "c-1")).toBe("completed");

    const unknown = await post(randomUUID(), body);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ code: "survey-not-available" });
    // The result ID is not the post ID.
    expect((await post(survey.resultId, body)).statusCode).toBe(404);
  });
});

describe("getQuestionSummary", () => {
  it("reuses a summary while the survey is unchanged and reads again after a new response", async () => {
    let pages = 0;
    const { server, publish } = await start({
      results: (store) => ({
        ...store,
        listResponsePage: (survey, page) => {
          pages += 1;
          return store.listResponsePage(survey, page);
        },
      }),
    });
    const survey = await publish({ pages: [] });
    const submit = (q: string) =>
      server.inject({
        method: "POST",
        url: `/api/v1/public/surveys/${survey.id}/responses`,
        payload: { data: { q } },
      });
    const summary = async (name = "q") => {
      const res = await server.inject({
        url: `/api/v1/public/results/${survey.resultId}/questions/${name}`,
      });
      expect(res.statusCode).toBe(200);
      return res.json<{ answered: number; values: unknown[]; responseCount: number }>();
    };
    expect((await submit("a")).statusCode).toBe(201);
    expect(await summary()).toMatchObject({ answered: 1, responseCount: 1 });
    const scanned = pages;
    expect(scanned).toBeGreaterThan(0);
    expect(await summary()).toMatchObject({ answered: 1, responseCount: 1 });
    expect(pages).toBe(scanned);
    // Another question of the same survey is its own entry.
    await summary("other");
    expect(pages).toBeGreaterThan(scanned);
    const before = pages;
    expect((await submit("b")).statusCode).toBe(201);
    expect(await summary()).toMatchObject({
      answered: 2,
      // Both stored at the test clock's one instant: in either order.
      values: expect.arrayContaining([
        { value: "a", count: 1 },
        { value: "b", count: 1 },
      ]) as unknown,
      responseCount: 2,
    });
    expect(pages).toBeGreaterThan(before);
  });
});

describe("getPublicDefinition", () => {
  it("answers 304 with the tag and no body, and 404 for an unknown survey", async () => {
    const { server, publish } = await start();
    const survey = await publish({ pages: [] });
    const url = `/api/v1/public/surveys/${survey.id}/definition`;
    const first = await server.inject({ method: "GET", url });
    expect(first.statusCode).toBe(200);
    const etag = first.headers.etag as string;
    const again = await server.inject({ method: "GET", url, headers: { "if-none-match": etag } });
    expect(again.statusCode).toBe(304);
    expect(again.headers.etag).toBe(etag);
    expect(again.headers["cache-control"]).toBe("no-cache");
    expect(again.body).toBe("");
    const unknown = await server.inject({
      method: "GET",
      url: `/api/v1/public/surveys/${randomUUID()}/definition`,
    });
    expect(unknown.statusCode).toBe(404);
  });
});

describe("getPublicResults from and till", () => {
  const FEEDBACK = "22222222-0000-4000-8000-a00000000001";
  const results = (server: FastifyInstance, query: string, surveyId = FEEDBACK) =>
    server.inject({ url: `/api/v1/public/surveys/${surveyId}/results?${query}` });

  it("refuses a leap second as the validator refuses any malformed date-time", async () => {
    const { server } = await start();
    for (const [name, value] of [
      ["from", "2026-04-01T23:59:60Z"],
      ["till", encodeURIComponent("2026-04-01T00:00:60+00:01")],
    ] as const) {
      const malformed = await results(server, `${name}=not-a-date`);
      const leap = await results(server, `${name}=${value}`);
      expect(malformed.statusCode).toBe(400);
      expect(leap.statusCode).toBe(400);
      expect(leap.headers["content-type"]).toBe(malformed.headers["content-type"]);
      expect(leap.json()).toStrictEqual(malformed.json());
    }
    const both = "from=2026-04-01T23:59:60Z&till=2026-04-01T23:59:60Z";
    expect((await results(server, both)).json()).toStrictEqual(
      (await results(server, "from=x&till=y")).json(),
    );
    // Refused before the survey is looked up, as the validator does.
    const unknown = await results(server, "from=2026-04-01T23:59:60Z", randomUUID());
    expect(unknown.statusCode).toBe(400);
  });

  it("hands the store the bounds as instants in toISOString form", async () => {
    const seen: ResponsePageQuery[] = [];
    const { server } = await start({
      results: (store) => ({
        ...store,
        listResponsePage: (survey, query) => {
          seen.push(query);
          return store.listResponsePage(survey, query);
        },
      }),
    });
    const query = `from=${encodeURIComponent("2026-04-01T12:30:00+02:00")}&till=2026-04-01T12:00:00Z`;
    const res = await results(server, query);
    expect(res.statusCode).toBe(200);
    expect(seen).toEqual([
      expect.objectContaining({
        from: "2026-04-01T10:30:00.000Z",
        till: "2026-04-01T12:00:00.000Z",
      }),
    ]);
  });
});

describe("deleteResponse", () => {
  const OLIVIA = "11111111-0000-4000-8000-a00000000001";
  const OSCAR = "11111111-0000-4000-8000-a00000000004";
  const FEEDBACK = "22222222-0000-4000-8000-a00000000001";
  const row = (n: number) => `66666666-0000-4000-8000-a0000000000${String(n)}`;

  it("deletes the run holding a save and clears the client's state; 404 for a second delete", async () => {
    const { server } = await start();
    const { headers } = await signIn(server, OLIVIA);
    const remove = (id: string) =>
      server.inject({
        method: "DELETE",
        url: `/api/v1/surveys/${FEEDBACK}/results/${id}`,
        headers,
      });
    const ids = async () =>
      (await server.inject({ url: `/api/v1/surveys/${FEEDBACK}/results`, headers }))
        .json<{ items: { id: string }[] }>()
        .items.map((item) => item.id);
    const state = async () =>
      (
        await server.inject({ url: `/api/v1/public/surveys/${FEEDBACK}/respondents/client-0001` })
      ).json<{ state: string }>().state;
    expect(await state()).toBe("partial");

    const res = await remove(row(2).toUpperCase());
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    expect(await ids()).toStrictEqual([row(1), row(3), row(4), row(5)]);
    expect(await state()).toBe("none");

    const again = await remove(row(2));
    expect(again.statusCode).toBe(404);
    expect(again.json()).toMatchObject({ code: "not-found" });
  });

  it("answers 404 for an unknown survey, an outsider or a non-GUID id, 400 for a long id, 401 without a session", async () => {
    const { server } = await start();
    const olivia = (await signIn(server, OLIVIA)).headers;
    const oscar = (await signIn(server, OSCAR)).headers;
    const remove = (surveyId: string, id: string, headers?: Record<string, string>) =>
      server.inject({
        method: "DELETE",
        url: `/api/v1/surveys/${surveyId}/results/${id}`,
        ...(headers && { headers }),
      });
    for (const res of [
      await remove(randomUUID(), row(1), olivia),
      await remove(FEEDBACK, row(1), oscar),
      await remove(FEEDBACK, "not-a-guid", olivia),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: "not-found" });
    }
    expect((await remove(FEEDBACK, "x".repeat(65), olivia)).statusCode).toBe(400);
    expect((await remove(FEEDBACK, row(1))).statusCode).toBe(401);
  });

  it("answers 403 to a user who can see the survey but not modify it, and deletes nothing", async () => {
    const ADMIN = "11111111-0000-4000-8000-a00000000002";
    const ENGINEERING = "55555555-0000-4000-8000-a00000000002";
    const deleted: string[] = [];
    const { server, providers } = await start({
      results: (store) => ({
        ...store,
        deleteResponse: (survey, id) => {
          deleted.push(id);
          return store.deleteResponse(survey, id);
        },
      }),
    });
    const survey = await providers.surveys.createSurvey({
      id: randomUUID(),
      name: "Engineering poll",
      owner: { kind: "project", projectId: ENGINEERING },
      creatorId: ADMIN,
      postId: randomUUID(),
      resultId: randomUUID(),
      createdAt: NOW,
      updatedAt: NOW,
    });
    const id = randomUUID();
    await providers.results.appendResponse(survey, { id, submittedAt: NOW, data: {} });
    const { headers } = await signIn(server, OLIVIA);
    const res = await server.inject({
      method: "DELETE",
      url: `/api/v1/surveys/${survey.id}/results/${id}`,
      headers,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "forbidden" });
    expect(deleted).toStrictEqual([]);
    expect(await providers.results.hasResponse(survey, id)).toBe(true);
  });
});

describe("listResults from and till", () => {
  const OLIVIA = "11111111-0000-4000-8000-a00000000001";
  const FEEDBACK = "22222222-0000-4000-8000-a00000000001";

  it("hands the store the bounds as instants and refuses a leap second as a malformed date-time", async () => {
    const seen: ResponsePageQuery[] = [];
    const { server } = await start({
      results: (store) => ({
        ...store,
        listResponsePage: (survey, query) => {
          seen.push(query);
          return store.listResponsePage(survey, query);
        },
      }),
    });
    const { headers } = await signIn(server, OLIVIA);
    const list = (query: string) =>
      server.inject({ url: `/api/v1/surveys/${FEEDBACK}/results?${query}`, headers });

    const res = await list(
      `from=${encodeURIComponent("2026-04-01T11:30:00+02:00")}&till=2026-04-01T11:45:00Z`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json<{ items: { id: string }[] }>().items.map((item) => item.id)).toStrictEqual([
      "66666666-0000-4000-8000-a00000000003",
    ]);
    expect(seen).toEqual([
      expect.objectContaining({
        from: "2026-04-01T09:30:00.000Z",
        till: "2026-04-01T11:45:00.000Z",
      }),
    ]);

    const malformed = await list("from=not-a-date");
    const leap = await list("from=2026-04-01T23:59:60Z");
    expect(malformed.statusCode).toBe(400);
    expect(leap.statusCode).toBe(400);
    expect(leap.json()).toStrictEqual(malformed.json());
  });
});
