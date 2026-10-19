import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createDevIdentityProvider } from "../auth/providers/dev.js";
import { signIn } from "../auth/testing.js";
import { loadConfig } from "../config.js";
import { newFileId } from "../domain/file-id.js";
import type { SurveyRecord, User } from "../domain/types.js";
import { createMemoryProviders, type MemorySeed } from "../providers/memory.js";
import type { FileStore, ProviderSet } from "../providers/types.js";

const NOW = "2026-10-15T08:30:00.000Z";
const QUOTA = 1000;
const USER: User = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  email: "user@example.com",
  displayName: "User",
  blocked: false,
};
const SURVEY_ID = "cccccccc-0000-4000-8000-00000000000a";

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

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Bytes detected as PNG, `size` long. */
const png = (size: number): Buffer => Buffer.concat([PNG_SIGNATURE, Buffer.alloc(size - 8)]);

const BOUNDARY = "----upload-test";

/** A multipart body with one file part. */
function fileBody(fileName: string, content: Buffer, field = "file"): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="${field}"; filename="${fileName}"\r\n` +
        "Content-Type: application/octet-stream\r\n\r\n",
    ),
    content,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
}

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** The app on a memory store (its FileStore changed by `files`), quota QUOTA, clock at NOW. */
async function start(
  options: {
    files?: (store: FileStore, memory: ProviderSet) => FileStore;
    logLines?: string[];
  } = {},
) {
  const config = loadConfig({
    NODE_ENV: "test",
    IDENTITY_PROVIDER: "dev",
    LIMIT_MAX_ASSET_BYTES_PER_SURVEY: String(QUOTA),
    LOG_LEVEL: "info",
  });
  const memory = createMemoryProviders(seed);
  const providers: ProviderSet = {
    ...memory,
    files: options.files ? options.files(memory.files, memory) : memory.files,
  };
  const { logLines } = options;
  app = await buildApp(config, providers, {
    identity: createDevIdentityProvider({ publicBaseUrl: config.publicBaseUrl, users: seed.users }),
    now: () => Date.parse(NOW),
    ...(logLines && { logStream: { write: (line: string) => logLines.push(line) } }),
  });
  const { headers } = await signIn(app, USER.id);
  const upload = (payload: Buffer | Readable) =>
    app!.inject({
      method: "POST",
      // Upper-case on purpose: stored files carry the survey's lower-case id.
      url: `/api/v1/surveys/${SURVEY_ID.toUpperCase()}/assets`,
      headers: { ...headers, "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
      payload,
    });
  return { providers: memory, upload };
}

describe("uploadSurveyAsset", () => {
  it("stores the file with the clock's time, the survey's lower-case id and the sanitized name", async () => {
    const { providers, upload } = await start();
    const res = await upload(fileBody("C:\\fakepath\\Logo\u0001.png ", png(100)));
    expect(res.statusCode).toBe(201);
    const { id } = res.json<{ id: string }>();
    expect(res.headers.location).toBe(`/api/v1/public/files/${id}`);
    const stored = await providers.files.getFile(id);
    stored?.content.destroy();
    expect(stored?.file).toStrictEqual({
      id,
      surveyId: SURVEY_ID,
      kind: "asset",
      name: "Logo.png",
      contentType: "image/png",
      size: 100,
      createdAt: NOW,
    });
  });

  it("deletes the new file and answers 413 when the total ends over the quota", async () => {
    let calls = 0;
    const { providers, upload } = await start({
      // The first usage check misses a concurrent upload.
      files: (store) => ({
        ...store,
        usage: async (surveyId, kind) => (calls++ === 0 ? 0 : store.usage(surveyId, kind)),
      }),
    });
    const earlier = newFileId(SURVEY_ID);
    await providers.files.putFile(
      {
        id: earlier,
        surveyId: SURVEY_ID,
        kind: "asset",
        name: "a.png",
        contentType: "image/png",
        size: 600,
        createdAt: NOW,
      },
      png(600),
    );
    const res = await upload(fileBody("b.png", png(600)));
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({
      code: "quota-exceeded",
      title: "File quota exceeded",
      detail: "This survey can store up to 1000 bytes of files.",
    });
    expect(await providers.files.usage(SURVEY_ID, "asset")).toBe(600);
  });

  it("deletes the new file and answers 404 when the survey was deleted while it was stored", async () => {
    let storedId: string | undefined;
    const { providers, upload } = await start({
      // The survey and its files are deleted after the access check, before the file lands.
      files: (store, memory) => ({
        ...store,
        putFile: async (file, content) => {
          storedId = file.id;
          await store.deleteSurveyFiles(SURVEY_ID);
          await memory.surveys.deleteSurvey(SURVEY_ID);
          await store.putFile(file, content);
        },
      }),
    });
    const res = await upload(fileBody("a.png", png(100)));
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "not-found", title: "Not found" });
    expect(storedId).toBeDefined();
    expect(await providers.files.getFile(storedId!)).toBeNull();
    expect(await providers.files.usage(SURVEY_ID, "asset")).toBe(0);
  });

  it("deletes the new file and answers 500 when the store fails after storing it", async () => {
    let storedId: string | undefined;
    let calls = 0;
    const { providers, upload } = await start({
      logLines: [],
      files: (store) => ({
        ...store,
        putFile: async (file, content) => {
          storedId = file.id;
          await store.putFile(file, content);
        },
        // The usage check after storing fails.
        usage: (surveyId, kind) =>
          calls++ === 0
            ? store.usage(surveyId, kind)
            : Promise.reject(new Error("store unavailable")),
      }),
    });
    const res = await upload(fileBody("a.png", png(100)));
    expect(res.statusCode).toBe(500);
    expect(storedId).toBeDefined();
    expect(await providers.files.getFile(storedId!)).toBeNull();
    expect(await providers.files.usage(SURVEY_ID, "asset")).toBe(0);
  });

  it("answers 413 when the byte over the quota arrives in a chunk of its own", async () => {
    const { providers, upload } = await start();
    const body = fileBody("a.png", png(QUOTA + 1));
    // The first chunk ends right after the QUOTA-th byte of the file.
    const split = body.indexOf("\r\n\r\n") + 4 + QUOTA;
    async function* chunks() {
      yield body.subarray(0, split);
      // The server reads the first chunk before the rest arrives.
      await new Promise((resolve) => setTimeout(resolve, 50));
      yield body.subarray(split);
    }
    const res = await upload(Readable.from(chunks()));
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: "quota-exceeded" });
    expect(await providers.files.usage(SURVEY_ID, "asset")).toBe(0);
  });

  it("answers 422 for a file in another field", async () => {
    const { upload } = await start();
    const res = await upload(fileBody("a.png", png(100), "image"));
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: "validation-failed",
      errors: [{ pointer: "/file", detail: "Send one file in the part named file." }],
    });
  });

  it("answers 400 for a cut multipart body", async () => {
    const { upload } = await start();
    const res = await upload(fileBody("a.png", png(100)).subarray(0, 150));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: "bad-request",
      title: "Bad request",
      detail: "The multipart body could not be read.",
    });
  });

  it("answers 500 when the store fails, without logging the file name", async () => {
    const logLines: string[] = [];
    const { upload } = await start({
      logLines,
      files: (store) => ({
        ...store,
        putFile: () => Promise.reject(new Error("store unavailable")),
      }),
    });
    const res = await upload(fileBody("private-name-7f3a.png", png(100)));
    expect(res.statusCode).toBe(500);
    const logged = logLines.join("");
    expect(logged).toContain("store unavailable");
    expect(logged).not.toContain("private-name-7f3a");
  });
});

describe("downloadFile", () => {
  it("sends the R7 headers", async () => {
    const { upload } = await start();
    const { id } = (await upload(fileBody("Logo ü.png", png(100)))).json<{ id: string }>();
    const res = await app!.inject({ url: `/api/v1/public/files/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload).toStrictEqual(png(100));
    expect(res.headers).toMatchObject({
      "content-type": "image/png",
      "content-length": "100",
      "content-disposition": `inline; filename="Logo _.png"; filename*=UTF-8''Logo%20%C3%BC.png`,
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      "cross-origin-resource-policy": "cross-origin",
    });
  });
});
