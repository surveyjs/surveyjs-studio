import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createDevIdentityProvider } from "../auth/providers/dev.js";
import { signIn } from "../auth/testing.js";
import { loadConfig } from "../config.js";
import type { SurveyRecord, User } from "../domain/types.js";
import { createMemoryProviders, type MemorySeed } from "../providers/memory.js";
import type { ProviderSet } from "../providers/types.js";

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
    { id: PROJECT_ID, name: "Team", ownerId: USER.id, createdAt: "2025-01-01T00:00:00.000Z" },
    {
      id: OTHER_PROJECT_ID,
      name: "Others",
      ownerId: "aaaaaaaa-0000-4000-8000-000000000009",
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
async function start(): Promise<{
  server: FastifyInstance;
  providers: ProviderSet;
  headers: Record<string, string>;
}> {
  const config = loadConfig({ NODE_ENV: "test", IDENTITY_PROVIDER: "dev" });
  const providers = createMemoryProviders(seed);
  app = await buildApp(config, providers, {
    identity: createDevIdentityProvider({ publicBaseUrl: config.publicBaseUrl, users: seed.users }),
    now: () => Date.parse(NOW),
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
  it("answers 201 with Location and the clock as createdAt and updatedAt", async () => {
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
      published: false,
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
