import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createDevIdentityProvider } from "../auth/providers/dev.js";
import { signIn } from "../auth/testing.js";
import { loadConfig } from "../config.js";
import { newFileId } from "../domain/file-id.js";
import type { StoredFileRecord, SurveyRecord, User } from "../domain/types.js";
import { createMemoryProviders, type MemorySeed } from "../providers/memory.js";
import type { FileStore, ProviderSet } from "../providers/types.js";

const NOW = "2026-10-15T08:30:00.000Z";
const USER: User = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  email: "user@example.com",
  displayName: "User",
  blocked: false,
};
const PROJECT_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID = "bbbbbbbb-0000-4000-8000-000000000002";

let n = 0;
function survey(
  name: string,
  owner: SurveyRecord["owner"],
  archived = false,
  creatorId: string = USER.id,
): SurveyRecord {
  n += 1;
  return {
    id: `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name,
    owner,
    creatorId,
    postId: `dddddddd-0000-4000-8000-${String(n).padStart(12, "0")}`,
    resultId: `eeeeeeee-0000-4000-8000-${String(n).padStart(12, "0")}`,
    published: false,
    archived,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
  };
}

const personal = { kind: "personal", userId: USER.id } as const;
const project = { kind: "project", projectId: PROJECT_ID } as const;

const seed: MemorySeed = {
  users: [USER],
  surveys: [
    survey("New Survey 2", personal),
    survey("New Survey 7", personal, true),
    survey("New Survey 4", project),
    survey("New Survey 9", { kind: "project", projectId: OTHER_PROJECT_ID }),
    // Made by someone else in USER's project: visible to USER, not modifiable.
    survey("Colleague poll", project, true, "aaaaaaaa-0000-4000-8000-000000000009"),
  ],
  projects: [
    { id: PROJECT_ID, name: "Team", creatorId: USER.id, createdAt: "2025-01-01T00:00:00.000Z" },
    {
      id: OTHER_PROJECT_ID,
      name: "Others",
      creatorId: "aaaaaaaa-0000-4000-8000-000000000009",
      createdAt: "2025-01-01T00:00:00.000Z",
    },
  ],
  memberships: [{ userId: USER.id, projectId: PROJECT_ID, role: "user" }],
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** The app on a memory store with the seed above, its clock fixed at NOW, signed in as USER. */
async function start(
  wrap: (providers: ProviderSet) => ProviderSet = (p) => p,
  logLines?: string[],
): Promise<{
  server: FastifyInstance;
  providers: ProviderSet;
  headers: Record<string, string>;
}> {
  const config = loadConfig({ NODE_ENV: "test", IDENTITY_PROVIDER: "dev" });
  const providers = wrap(createMemoryProviders(seed));
  app = await buildApp(config, providers, {
    identity: createDevIdentityProvider({ publicBaseUrl: config.publicBaseUrl, users: seed.users }),
    now: () => Date.parse(NOW),
    ...(logLines && { logStream: { write: (line: string) => logLines.push(line) } }),
  });
  const { headers } = await signIn(app, USER.id);
  return { server: app, providers, headers };
}

function create(server: FastifyInstance, headers: Record<string, string>, payload?: object) {
  return server.inject({
    method: "POST",
    url: "/api/v1/surveys",
    headers,
    ...(payload && { payload }),
  });
}

describe("createSurvey", () => {
  it("names a survey from the active personal surveys, ignoring archived ones", async () => {
    const { server, headers } = await start();
    const res = await create(server, headers);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: "New Survey 3", projectId: null });
  });

  it("creates a published survey, which the run page serves at once", async () => {
    const { server, headers } = await start();
    const res = await create(server, headers);
    expect(res.json()).toMatchObject({ published: true });
    const run = await server.inject({
      url: `/api/v1/public/surveys/${res.json<{ id: string }>().id}`,
    });
    expect(run.statusCode).toBe(200);
  });

  it("names a project survey from that project's surveys only", async () => {
    const { server, headers } = await start();
    const res = await create(server, headers, { projectId: PROJECT_ID });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: "New Survey 5",
      projectId: PROJECT_ID,
      permissions: { canModify: true },
    });
  });

  it("stamps the creation with the clock and answers its Location", async () => {
    const { server, headers } = await start();
    const res = await create(server, headers, { name: "Timed" });
    const body = res.json<{ id: string; createdAt: string; updatedAt: string }>();
    expect(body.createdAt).toBe(NOW);
    expect(body.updatedAt).toBe(NOW);
    expect(res.headers.location).toBe(`/api/v1/surveys/${body.id}`);
    const read = await server.inject({ url: `/api/v1/surveys/${body.id}`, headers });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toStrictEqual(body);
  });

  it("stores the definition it was given", async () => {
    const { server, headers, providers } = await start();
    const definition = { title: "Feedback", pages: [{ name: "page1", elements: [] }] };
    const res = await create(server, headers, { definition });
    expect(res.statusCode).toBe(201);
    const { id } = res.json<{ id: string }>();
    expect((await providers.surveys.getDefinition(id))?.content).toEqual(definition);
  });

  it("stores no definition without one, so it reads as an empty survey", async () => {
    const { server, headers, providers } = await start();
    const { id } = (await create(server, headers)).json<{ id: string }>();
    expect((await providers.surveys.getDefinition(id))?.content).toEqual({});
  });

  it("rejects a blank name with 422 validation-failed at /name", async () => {
    const { server, headers } = await start();
    const res = await create(server, headers, { name: "   " });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: "validation-failed", errors: [{ pointer: "/name" }] });
  });

  it("rejects a name that is too long for the legacy column with 422", async () => {
    const { server, headers } = await start();
    // 101 characters by the schema, 202 UTF-16 code units.
    const res = await create(server, headers, { name: "😀".repeat(101) });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: "validation-failed", errors: [{ pointer: "/name" }] });
    const fits = await create(server, headers, { name: "😀".repeat(100) });
    expect(fits.statusCode).toBe(201);
  });

  it("refuses a project the user is not a member of with 403 forbidden", async () => {
    const { server, headers } = await start();
    const res = await create(server, headers, { projectId: OTHER_PROJECT_ID });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: "forbidden",
      detail: "You are not a member of this project.",
    });
  });
});

describe("listSurveys", () => {
  it("lists a new survey first in its scope", async () => {
    const { server, headers } = await start();
    const { id } = (await create(server, headers)).json<{ id: string }>();
    const res = await server.inject({ url: "/api/v1/surveys", headers });
    expect(res.statusCode).toBe(200);
    const { items } = res.json<{ items: { id: string }[] }>();
    expect(items.map((item) => item.id)).toEqual([id, seed.surveys[0]?.id]);
  });

  it("answers 404 for a project the user is not a member of", async () => {
    const { server, headers } = await start();
    const res = await server.inject({
      url: `/api/v1/surveys?project=${OTHER_PROJECT_ID}`,
      headers,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "not-found" });
  });

  it("answers 400 for a malformed cursor", async () => {
    const { server, headers } = await start();
    const res = await server.inject({ url: "/api/v1/surveys?cursor=abc", headers });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "bad-request", detail: "Invalid cursor." });
  });
});

const [ownPersonal, , ownProject, , colleaguePoll] = seed.surveys;

function patch(
  server: FastifyInstance,
  headers: Record<string, string>,
  id: string | undefined,
  payload: object,
) {
  return server.inject({ method: "PATCH", url: `/api/v1/surveys/${id}`, headers, payload });
}

describe("updateSurvey", () => {
  it("sets updatedAt to the clock, also when no value changes", async () => {
    const { server, headers } = await start();
    const res = await patch(server, headers, ownPersonal?.id, { name: ownPersonal?.name });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: "New Survey 2", updatedAt: NOW });
  });

  it("moves a survey to the Personal scope and keeps the rights of the new scope", async () => {
    const { server, headers } = await start();
    const res = await patch(server, headers, ownProject?.id, { projectId: null });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ projectId: null, permissions: { canModify: true } });
  });

  it("answers 403 with the reason for a survey the user cannot modify", async () => {
    const { server, headers } = await start();
    const res = await patch(server, headers, colleaguePoll?.id, { name: "Mine now" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: "forbidden",
      detail: "You cannot modify this survey.",
    });
  });

  it("answers 403 for a target project the user is not a member of", async () => {
    const { server, headers } = await start();
    const res = await patch(server, headers, ownPersonal?.id, { projectId: OTHER_PROJECT_ID });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: "forbidden",
      detail: "You are not a member of this project.",
    });
  });

  it("answers 404 for a survey of someone else", async () => {
    const { server, headers } = await start();
    const res = await patch(server, headers, seed.surveys[3]?.id, { name: "x" });
    expect(res.statusCode).toBe(404);
  });

  it("keeps the private-question list when the survey update fails", async () => {
    const { server, headers, providers } = await start((p) => ({
      ...p,
      surveys: { ...p.surveys, updateSurvey: () => Promise.reject(new Error("store down")) },
    }));
    const id = ownPersonal?.id ?? "";
    await providers.views.savePrivateQuestions(id, ["q1"]);
    const res = await patch(server, headers, id, {
      settings: { privateResultQuestions: ["q2"] },
    });
    expect(res.statusCode).toBe(500);
    expect(await providers.views.getPrivateQuestions(id)).toEqual(["q1"]);
  });
});

describe("a private-question list that cannot be read", () => {
  const unreadable = (p: ProviderSet): ProviderSet => ({
    ...p,
    views: {
      ...p.views,
      getPrivateQuestions: () => Promise.reject(new Error("list unreadable")),
    },
  });

  /** The warnings logged, as parsed JSON lines. */
  const warningsOf = (lines: string[]) =>
    lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.level === 40);

  it("answers getSurvey without the list and logs a warning with the survey id only", async () => {
    const logLines: string[] = [];
    const { server, headers } = await start(unreadable, logLines);
    const id = ownPersonal?.id ?? "";
    const res = await server.inject({ url: `/api/v1/surveys/${id}`, headers });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ settings: Record<string, unknown> }>();
    expect(body.settings).not.toHaveProperty("privateResultQuestions");
    const warnings = warningsOf(logLines);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ surveyId: id });
    expect(logLines.join("\n")).not.toContain("list unreadable");
  });

  it("answers updateSurvey without the list when it is not part of the change", async () => {
    const logLines: string[] = [];
    const { server, headers } = await start(unreadable, logLines);
    const res = await patch(server, headers, ownPersonal?.id, { name: "Renamed" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ name: string; settings: Record<string, unknown> }>();
    expect(body.name).toBe("Renamed");
    expect(body.settings).not.toHaveProperty("privateResultQuestions");
    expect(warningsOf(logLines)).toHaveLength(1);
  });
});

describe("deleteSurvey", () => {
  it("answers 409 survey-not-archived for an active survey", async () => {
    const { server, headers } = await start();
    const res = await server.inject({
      method: "DELETE",
      url: `/api/v1/surveys/${ownPersonal?.id}`,
      headers,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: "survey-not-archived",
      title: "Archive the survey before deleting it",
    });
  });

  it("answers 403 with the reason for an archived survey the user cannot modify", async () => {
    const { server, headers } = await start();
    const res = await server.inject({
      method: "DELETE",
      url: `/api/v1/surveys/${colleaguePoll?.id}`,
      headers,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ detail: "You cannot modify this survey." });
  });

  it("deletes an archived survey with 204 and an empty body", async () => {
    const { server, headers } = await start();
    const archived = seed.surveys[1];
    const res = await server.inject({
      method: "DELETE",
      url: `/api/v1/surveys/${archived?.id}`,
      headers,
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    const read = await server.inject({ url: `/api/v1/surveys/${archived?.id}`, headers });
    expect(read.statusCode).toBe(404);
  });
});

describe("cloneSurvey", () => {
  it("answers 201 with Location, the clock as createdAt and updatedAt, and a published copy of an unpublished source", async () => {
    const { server, headers } = await start();
    const res = await server.inject({
      method: "POST",
      url: `/api/v1/surveys/${ownProject?.id}/clones`,
      headers,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; createdAt: string; updatedAt: string }>();
    expect(body).toMatchObject({
      name: "Copy of New Survey 4",
      projectId: PROJECT_ID,
      published: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(res.headers.location).toBe(`/api/v1/surveys/${body.id}`);
  });

  it("makes the caller the creator, so a copy of a survey they cannot modify is modifiable", async () => {
    const { server, headers } = await start();
    const res = await server.inject({
      method: "POST",
      url: `/api/v1/surveys/${colleaguePoll?.id}/clones`,
      headers,
      payload: { name: "Mine" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: "Mine", permissions: { canModify: true } });
  });

  it("answers 403 for a target project the user is not a member of", async () => {
    const { server, headers } = await start();
    const res = await server.inject({
      method: "POST",
      url: `/api/v1/surveys/${ownPersonal?.id}/clones`,
      headers,
      payload: { projectId: OTHER_PROJECT_ID },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ detail: "You are not a member of this project." });
  });
});

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);
const PADDED = Buffer.concat([PNG, Buffer.from("pad")]);

/** Stores a file of `surveyId` through the provider; returns its id. */
async function putAsset(providers: ProviderSet, surveyId: string, bytes: Buffer): Promise<string> {
  const id = newFileId(surveyId);
  const file: StoredFileRecord = {
    id,
    surveyId,
    kind: "asset",
    name: "a.png",
    contentType: "image/png",
    size: bytes.length,
    createdAt: NOW,
  };
  await providers.files.putFile(file, bytes);
  return id;
}

async function readAll(files: FileStore, id: string): Promise<Buffer | null> {
  const found = await files.getFile(id);
  if (!found) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of found.content) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const fileUrl = (id: string): string => `http://localhost/api/v1/public/files/${id}`;

/** The id in a `/public/files/` URL of `value`, or null. */
const fileIdIn = (value: unknown): string | null =>
  /\/public\/files\/([0-9a-f]{64})/.exec(JSON.stringify(value))?.[1] ?? null;

describe("files of a deleted survey", () => {
  const archived = seed.surveys[1];

  function remove(server: FastifyInstance, headers: Record<string, string>, id?: string) {
    return server.inject({ method: "DELETE", url: `/api/v1/surveys/${id}`, headers });
  }

  it("deleting an archived survey deletes all its files", async () => {
    const { server, providers, headers } = await start();
    const ids = [
      await putAsset(providers, archived?.id ?? "", PNG),
      await putAsset(providers, archived?.id ?? "", PADDED),
    ];
    const res = await remove(server, headers, archived?.id);
    expect(res.statusCode).toBe(204);
    for (const id of ids) expect(await providers.files.getFile(id)).toBeNull();
  });

  it("keeps the files when the delete is refused with 409", async () => {
    const { server, providers, headers } = await start();
    const id = await putAsset(providers, ownPersonal?.id ?? "", PNG);
    const res = await remove(server, headers, ownPersonal?.id);
    expect(res.statusCode).toBe(409);
    expect(await readAll(providers.files, id)).toEqual(PNG);
  });

  it("keeps the files when the delete is refused with 403", async () => {
    const { server, providers, headers } = await start();
    const id = await putAsset(providers, colleaguePoll?.id ?? "", PNG);
    const res = await remove(server, headers, colleaguePoll?.id);
    expect(res.statusCode).toBe(403);
    expect(await readAll(providers.files, id)).toEqual(PNG);
  });
});

describe("files of a cloned survey", () => {
  const clone = (server: FastifyInstance, headers: Record<string, string>, id?: string) =>
    server.inject({ method: "POST", url: `/api/v1/surveys/${id}/clones`, headers });

  /** Saves a definition (and a theme when given) as the source survey's documents. */
  async function saveDocuments(
    providers: ProviderSet,
    id: string,
    definition: Record<string, unknown>,
    theme?: Record<string, unknown>,
  ) {
    const current = await providers.surveys.getDefinition(id);
    await providers.surveys.saveDefinition(id, definition, {
      userId: USER.id,
      savedAt: NOW,
      ifVersion: current?.version ?? "",
    });
    if (!theme) return;
    const currentTheme = await providers.surveys.getTheme(id);
    await providers.surveys.saveTheme(id, theme, {
      savedAt: NOW,
      ifVersion: currentTheme?.version ?? "",
    });
  }

  it("gives the copy its own files and rewrites their URLs in the definition and theme", async () => {
    const { server, providers, headers } = await start();
    const sourceId = ownPersonal?.id ?? "";
    const logoId = await putAsset(providers, sourceId, PNG);
    const backgroundId = await putAsset(providers, sourceId, PADDED);
    const definition = { title: "T", logo: fileUrl(logoId) };
    const theme = { themeName: "x", backgroundImage: fileUrl(backgroundId) };
    await saveDocuments(providers, sourceId, definition, theme);

    const res = await clone(server, headers, sourceId);
    expect(res.statusCode).toBe(201);
    const copyId = res.json<{ id: string }>().id;
    const copyDefinition = (await providers.surveys.getDefinition(copyId))?.content;
    const copyTheme = (await providers.surveys.getTheme(copyId))?.content;
    const newLogo = fileIdIn(copyDefinition) ?? "";
    const newBackground = fileIdIn(copyTheme) ?? "";
    const copyPrefix = copyId.replaceAll("-", "");
    expect(newLogo.startsWith(copyPrefix)).toBe(true);
    expect(newBackground.startsWith(copyPrefix)).toBe(true);
    expect(copyDefinition).toEqual({ title: "T", logo: fileUrl(newLogo) });
    expect(copyTheme).toEqual({ themeName: "x", backgroundImage: fileUrl(newBackground) });
    expect(await readAll(providers.files, newLogo)).toEqual(PNG);
    expect(await readAll(providers.files, newBackground)).toEqual(PADDED);
    // The source is unchanged.
    expect((await providers.surveys.getDefinition(sourceId))?.content).toEqual(definition);
    expect((await providers.surveys.getTheme(sourceId))?.content).toEqual(theme);
    expect(await readAll(providers.files, logoId)).toEqual(PNG);
  });

  it("copies a definition and theme without files as they are", async () => {
    const { server, providers, headers } = await start();
    const sourceId = ownPersonal?.id ?? "";
    const definition = { title: "Plain", pages: [] };
    await saveDocuments(providers, sourceId, definition);
    const res = await clone(server, headers, sourceId);
    const copyId = res.json<{ id: string }>().id;
    expect((await providers.surveys.getDefinition(copyId))?.content).toEqual(definition);
    expect((await providers.surveys.getTheme(copyId))?.content).toEqual(
      (await providers.surveys.getTheme(sourceId))?.content,
    );
  });

  it("leaves no files under the copy's id when the store call fails", async () => {
    let copyId = "";
    const { server, providers, headers } = await start((base) => ({
      ...base,
      files: {
        ...base.files,
        copySurveyAssets: (from, to, at) => {
          copyId = to;
          return base.files.copySurveyAssets(from, to, at);
        },
      },
      surveys: {
        ...base.surveys,
        cloneSurvey: () => Promise.reject(new Error("store down")),
      },
    }));
    await putAsset(providers, ownPersonal?.id ?? "", PNG);
    const res = await clone(server, headers, ownPersonal?.id);
    expect(res.statusCode).toBe(500);
    expect(copyId).not.toBe("");
    expect(await providers.files.usage(copyId, "asset")).toBe(0);
  });

  it("leaves no files under the copy's id when copying the files itself fails", async () => {
    let copyId = "";
    const { server, providers, headers } = await start((base) => ({
      ...base,
      files: {
        ...base.files,
        copySurveyAssets: async (_from, to) => {
          copyId = to;
          await putAsset(base, to, PNG);
          throw new Error("copy failed");
        },
      },
    }));
    const res = await clone(server, headers, ownPersonal?.id);
    expect(res.statusCode).toBe(500);
    expect(copyId).not.toBe("");
    expect(await providers.files.usage(copyId, "asset")).toBe(0);
  });
});
