// R21: whatever a respondent sends (answers, client id, file name and bytes, full address) never
// reaches the logs, even at the most verbose level.
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { SurveyRecord } from "../domain/types.js";
import { createProviders } from "../providers/index.js";
import type { ProviderSet, ResultStore } from "../providers/types.js";

const ANSWER = "respondent-answer-Marker-81";
const CLIENT_ID = "respondent-client-Marker-82";
const FILE_NAME = "respondent-file-Marker-83.txt";
const FILE_BYTES = "respondent-bytes-Marker-84";
const MARKERS = [ANSWER, CLIENT_ID, FILE_NAME, FILE_BYTES];
const MAX_RESPONSE_BYTES = 2048;
const RESPONDENT_IP = "203.0.113.7";
const OWNER = "aaaaaaaa-0000-4000-8000-000000000001";
const NOW = "2026-10-15T08:30:00.000Z";

/** A survey that limits responses to one per client, with a text and a file question. */
const DEFINITION = {
  cookieName: "respondent-logs",
  pages: [
    {
      name: "page1",
      elements: [
        { type: "text", name: "text" },
        { type: "file", name: "attachment", storeDataAsText: false },
      ],
    },
  ],
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** The app on memory, logging everything into `lines`, with a survey of its own published. */
async function start(
  options: {
    results?: (store: ResultStore) => ResultStore;
    storeRespondentIp?: boolean;
  } = {},
) {
  const config = loadConfig({
    NODE_ENV: "test",
    IDENTITY_PROVIDER: "dev",
    LOG_LEVEL: "trace",
    // inject() connects from 127.0.0.1: X-Forwarded-For then names the respondent.
    TRUST_PROXY: "127.0.0.1",
    LIMIT_MAX_RESPONSE_BYTES: String(MAX_RESPONSE_BYTES),
  });
  const memory = await createProviders(config);
  const providers: ProviderSet = {
    ...memory,
    results: options.results ? options.results(memory.results) : memory.results,
  };
  const lines: string[] = [];
  const server = await buildApp(config, providers, {
    now: () => Date.parse(NOW),
    logStream: { write: (line: string) => lines.push(line) },
  });
  app = server;
  const id = randomUUID();
  await providers.surveys.createSurvey(
    {
      id,
      name: "Respondent logs",
      owner: { kind: "personal", userId: OWNER },
      creatorId: OWNER,
      postId: randomUUID(),
      resultId: randomUUID(),
      createdAt: NOW,
      updatedAt: NOW,
    },
    DEFINITION,
  );
  const survey: SurveyRecord = (await providers.surveys.updateSurvey(id, {
    published: true,
    ...(options.storeRespondentIp && {
      settings: { storeRespondentIp: true },
    }),
    updatedAt: NOW,
  }))!;
  const submit = (body: unknown, headers: Record<string, string> = {}) =>
    server.inject({
      method: "POST",
      url: `/api/v1/public/surveys/${survey.id}/responses`,
      headers: { "x-forwarded-for": RESPONDENT_IP, ...headers },
      payload: body as object,
    });
  return { server, providers, survey, submit, logged: () => lines.join("") };
}

const answers = { data: { text: ANSWER }, clientId: CLIENT_ID };

/** No marker and no full respondent address in the logs; the address only as truncated. */
function expectNoRespondentData(logged: string): void {
  // The capture works: the request itself was logged.
  expect(logged).toContain("incoming request");
  for (const marker of MARKERS) expect(logged).not.toContain(marker);
  expect(logged).not.toContain(RESPONDENT_IP);
  expect(logged).toContain("203.0.113.0");
}

describe("respondent data in the logs (R21)", () => {
  it("is absent for a stored submission", async () => {
    const { submit, logged } = await start();
    const res = await submit(answers, { "idempotency-key": "key-1" });
    expect(res.statusCode).toBe(201);
    expectNoRespondentData(logged());
  });

  it("is absent for an idempotent replay", async () => {
    const { submit, logged } = await start();
    const first = await submit(answers, { "idempotency-key": "key-1" });
    const replay = await submit(answers, { "idempotency-key": "key-1" });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toStrictEqual(first.json());
    expectNoRespondentData(logged());
  });

  it("is absent for an invalid body (422)", async () => {
    const { submit, logged } = await start();
    const res = await submit({ data: ANSWER, clientId: CLIENT_ID });
    expect(res.statusCode).toBe(422);
    expectNoRespondentData(logged());
  });

  it("is absent for an oversize body (413)", async () => {
    const { submit, logged } = await start();
    const res = await submit({
      data: { text: `${ANSWER}${"x".repeat(MAX_RESPONSE_BYTES)}` },
      clientId: CLIENT_ID,
    });
    expect(res.statusCode).toBe(413);
    expectNoRespondentData(logged());
  });

  it("is absent, the address included, when the survey keeps respondent addresses", async () => {
    const { providers, survey, submit, logged } = await start({ storeRespondentIp: true });
    const res = await submit(answers);
    expect(res.statusCode).toBe(201);
    // The address is stored in full; only the logs truncate it.
    expect((await providers.results.listResponses(survey))[0]?.respondentIp).toBe(RESPONDENT_IP);
    expectNoRespondentData(logged());
  });

  it("is absent when the store fails (500), which is logged", async () => {
    const { submit, logged } = await start({
      results: (store) => ({
        ...store,
        appendResponse: () => Promise.reject(new Error("result store unavailable")),
      }),
    });
    const res = await submit(answers);
    expect(res.statusCode).toBe(500);
    expect(logged()).toContain("result store unavailable");
    expectNoRespondentData(logged());
  });

  it("is absent for a respondent file upload", async () => {
    const { server, survey, logged } = await start();
    const boundary = "----respondent-logs";
    const res = await server.inject({
      method: "POST",
      url: `/api/v1/public/surveys/${survey.id}/files`,
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "x-forwarded-for": RESPONDENT_IP,
      },
      payload:
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${FILE_NAME}"\r\n` +
        "Content-Type: text/plain\r\n\r\n" +
        `${FILE_BYTES}\r\n--${boundary}--\r\n`,
    });
    expect(res.statusCode).toBe(201);
    expectNoRespondentData(logged());
  });
});
