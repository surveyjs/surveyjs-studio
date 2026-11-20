// The fake Studio's survey records for the access-key action tests: `listSurveys`, `getSurvey`,
// `createSurvey`, `updateSurvey`, `deleteSurvey`, `cloneSurvey`, `getSurveyDefinition` and
// `getSurveyTheme`, with Studio's visibility and modify rules (ADR 0009) for the caller the bearer
// credential names. Ids are lower-case GUIDs; times advance one second per write.
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { components } from "@surveyjs-studio/contract/types";
import type { RecordedRequest } from "./http.js";

type Survey = components["schemas"]["Survey"];

export interface StoredSurvey {
  id: string;
  name: string;
  /** `null`: Personal, owned by `ownerUserId`. */
  projectId: string | null;
  ownerUserId: string;
  creatorId: string | null;
  published: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  postId: string;
  resultId: string;
  useCookies: boolean;
  legacyPublishId: string | null;
  publicResults: boolean;
  storeRespondentIp: boolean;
  /** The theme object; `null` without one. */
  theme: Record<string, unknown> | null;
  /** The definition as Studio's JSON text. */
  definition: string;
  /** The definition saves, oldest first (`PUT definition` adds one). */
  history: { id: string; definition: string; at: string; userId: string }[];
}

/** A file `POST /legacy-files` stored. */
export interface StoredUpload {
  legacyName: string;
  fileName: string;
  bytes: number;
  userId: string;
}

export interface SurveyStore {
  surveys: Map<string, StoredSurvey>;
  /** By user ID: the user's projects and roles. */
  memberships: Map<string, Map<string, "admin" | "user">>;
  /** Items per page of `listSurveys`, whatever `limit` asks (`undefined`: `limit`). */
  surveyPageSize: number | undefined;
  /** The files `POST /legacy-files` stored, in order. */
  uploads: StoredUpload[];
  /** The next write's time (advances one second per write). */
  clock: number;
}

export const START_TIME = Date.parse("2026-11-19T10:00:00.127Z");

export function newSurveyStore(): SurveyStore {
  return {
    surveys: new Map(),
    memberships: new Map(),
    surveyPageSize: undefined,
    uploads: [],
    clock: START_TIME,
  };
}

export function resetSurveyStore(store: SurveyStore): void {
  store.surveys.clear();
  store.memberships.clear();
  store.surveyPageSize = undefined;
  store.uploads.length = 0;
  store.clock = START_TIME;
}

/** A stored survey with defaults for what the test does not give. */
export function storedSurvey(
  fields: Partial<StoredSurvey> & Pick<StoredSurvey, "ownerUserId">,
): StoredSurvey {
  return {
    id: randomUUID(),
    name: "Survey",
    projectId: null,
    creatorId: fields.ownerUserId,
    published: true,
    archived: false,
    createdAt: "2025-01-02T03:04:05.11Z",
    updatedAt: "2026-11-19T10:00:00.127Z",
    postId: randomUUID(),
    resultId: randomUUID(),
    useCookies: false,
    legacyPublishId: null,
    publicResults: false,
    storeRespondentIp: false,
    theme: null,
    definition: "{}",
    history: [],
    ...fields,
  };
}

function tick(store: SurveyStore): string {
  const at = new Date(store.clock).toISOString();
  store.clock += 1000;
  return at;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function problem(res: ServerResponse, status: number, code: string): void {
  res
    .writeHead(status, { "content-type": "application/problem+json" })
    .end(JSON.stringify({ type: "about:blank", title: "Problem", status, code }));
}

function roleOf(store: SurveyStore, userId: string, projectId: string) {
  return store.memberships.get(userId)?.get(projectId);
}

function canSee(store: SurveyStore, survey: StoredSurvey, userId: string): boolean {
  return survey.projectId === null
    ? survey.ownerUserId === userId
    : roleOf(store, userId, survey.projectId) !== undefined;
}

function canModify(store: SurveyStore, survey: StoredSurvey, userId: string): boolean {
  if (survey.projectId === null) return survey.ownerUserId === userId;
  const role = roleOf(store, userId, survey.projectId);
  return role === "admin" || (role !== undefined && survey.creatorId === userId);
}

function surveyJson(
  store: SurveyStore,
  survey: StoredSurvey,
  userId: string,
  withTheme: boolean,
): Survey {
  return {
    id: survey.id,
    name: survey.name,
    projectId: survey.projectId,
    published: survey.published,
    archived: survey.archived,
    createdAt: survey.createdAt,
    updatedAt: survey.updatedAt,
    postId: survey.postId,
    resultId: survey.resultId,
    permissions: { canModify: canModify(store, survey, userId) },
    useCookies: survey.useCookies,
    creatorId: survey.creatorId,
    legacyPublishId: survey.legacyPublishId,
    ...(withTheme && { theme: survey.theme }),
    settings: {
      publicResults: survey.publicResults,
      storeRespondentIp: survey.storeRespondentIp,
      useCookies: survey.useCookies,
    },
  };
}

const API = "/api/v1";

function readBody(request: RecordedRequest): Record<string, unknown> {
  if (request.body.length === 0) return {};
  return JSON.parse(request.body.toString()) as Record<string, unknown>;
}

/** Whether `name` is a name Studio takes (1–200 characters). */
const validName = (name: unknown) =>
  typeof name === "string" && name.length >= 1 && name.length <= 200;

/**
 * Answers a survey operation for `userId` (the bearer's user); false for any other path.
 */
export function surveyOperation(
  store: SurveyStore,
  request: RecordedRequest,
  res: ServerResponse,
  userId: string | undefined,
): boolean {
  const url = new URL(request.url, "http://studio");
  if (url.pathname === `${API}/legacy-files` && request.method === "POST") {
    if (userId === undefined) problem(res, 401, "unauthenticated");
    else void legacyUpload(store, request, res, userId);
    return true;
  }
  if (!url.pathname.startsWith(`${API}/surveys`)) return false;
  if (userId === undefined) {
    problem(res, 401, "unauthenticated");
    return true;
  }
  const segments = url.pathname.slice(`${API}/`.length).split("/");
  const route = `${request.method} ${segments.map((s, i) => (i % 2 === 1 ? ":" : s)).join("/")}`;
  const id = segments[1] ?? "";
  const survey = store.surveys.get(id);
  const visible = survey !== undefined && canSee(store, survey, userId);

  switch (route) {
    case "GET surveys":
      listSurveys(store, url, res, userId);
      return true;
    case "POST surveys": {
      const body = readBody(request);
      if (body.name !== undefined && !validName(body.name)) {
        problem(res, 422, "validation-failed");
        return true;
      }
      const projectId = body.projectId as string | null | undefined;
      if (typeof projectId === "string" && roleOf(store, userId, projectId) === undefined) {
        problem(res, 403, "forbidden");
        return true;
      }
      const at = tick(store);
      const created = storedSurvey({
        ownerUserId: userId,
        projectId: projectId ?? null,
        name: (body.name as string | undefined) ?? "New Survey 1",
        createdAt: at,
        updatedAt: at,
        definition: JSON.stringify(body.definition ?? {}),
      });
      store.surveys.set(created.id, created);
      json(res, 201, surveyJson(store, created, userId, false));
      return true;
    }
    case "GET surveys/:":
      if (!visible) problem(res, 404, "not-found");
      else json(res, 200, surveyJson(store, survey, userId, false));
      return true;
    case "PATCH surveys/:": {
      if (!visible) return (problem(res, 404, "not-found"), true);
      if (!canModify(store, survey, userId)) return (problem(res, 403, "forbidden"), true);
      const patch = readBody(request);
      if (Object.keys(patch).length === 0) return (problem(res, 400, "bad-request"), true);
      if (patch.name !== undefined && !validName(patch.name)) {
        return (problem(res, 422, "validation-failed"), true);
      }
      if (patch.projectId !== undefined) {
        const target = patch.projectId as string | null;
        if (target !== null && roleOf(store, userId, target) === undefined) {
          return (problem(res, 403, "forbidden"), true);
        }
        survey.projectId = target;
        if (target === null) survey.ownerUserId = userId;
        survey.creatorId = userId;
      }
      if (typeof patch.name === "string") survey.name = patch.name;
      if (typeof patch.archived === "boolean") survey.archived = patch.archived;
      if (typeof patch.published === "boolean") survey.published = patch.published;
      const settings = (patch.settings ?? {}) as Record<string, unknown>;
      if (typeof settings.publicResults === "boolean")
        survey.publicResults = settings.publicResults;
      if (typeof settings.storeRespondentIp === "boolean") {
        survey.storeRespondentIp = settings.storeRespondentIp;
      }
      if (typeof settings.useCookies === "boolean") survey.useCookies = settings.useCookies;
      survey.updatedAt = tick(store);
      json(res, 200, surveyJson(store, survey, userId, false));
      return true;
    }
    case "DELETE surveys/:":
      if (!visible) problem(res, 404, "not-found");
      else if (!canModify(store, survey, userId)) problem(res, 403, "forbidden");
      else if (!survey.archived) problem(res, 409, "survey-not-archived");
      else {
        store.surveys.delete(id);
        res.writeHead(204).end();
      }
      return true;
    case "POST surveys/:/clones": {
      if (!visible) return (problem(res, 404, "not-found"), true);
      const body = readBody(request);
      const at = tick(store);
      const copy = storedSurvey({
        ownerUserId: survey.projectId === null ? survey.ownerUserId : userId,
        projectId: survey.projectId,
        creatorId: userId,
        name: (body.name as string | undefined) ?? `Copy of ${survey.name}`.slice(0, 200),
        createdAt: at,
        updatedAt: at,
        theme: survey.theme,
        definition: survey.definition,
      });
      store.surveys.set(copy.id, copy);
      json(res, 201, surveyJson(store, copy, userId, false));
      return true;
    }
    case "GET surveys/:/definition":
      if (!visible) problem(res, 404, "not-found");
      else res.writeHead(200, { "content-type": "application/json" }).end(survey.definition);
      return true;
    case "PUT surveys/:/definition": {
      if (!visible) return (problem(res, 404, "not-found"), true);
      if (!canModify(store, survey, userId)) return (problem(res, 403, "forbidden"), true);
      if (request.headers["if-match"] !== "*")
        return (problem(res, 428, "precondition-required"), true);
      const body = parseObject(request);
      if (body === undefined) return (problem(res, 422, "validation-failed"), true);
      survey.definition = JSON.stringify(body);
      survey.updatedAt = tick(store);
      survey.history.push({
        id: randomUUID(),
        definition: survey.definition,
        at: survey.updatedAt,
        userId,
      });
      res.writeHead(204).end();
      return true;
    }
    case "PUT surveys/:/theme": {
      if (!visible) return (problem(res, 404, "not-found"), true);
      if (!canModify(store, survey, userId)) return (problem(res, 403, "forbidden"), true);
      const body = parseObject(request);
      if (body === undefined) return (problem(res, 400, "bad-request"), true);
      survey.theme = Object.keys(body).length === 0 ? null : body;
      survey.updatedAt = tick(store);
      res.writeHead(204).end();
      return true;
    }
    case "GET surveys/:/history":
      if (!visible) return (problem(res, 404, "not-found"), true);
      json(res, 200, {
        items: [...survey.history].reverse().map((entry) => ({
          id: entry.id,
          at: entry.at,
          user: { id: entry.userId, displayName: "A user" },
        })),
        nextCursor: null,
      });
      return true;
    case "GET surveys/:/history/:": {
      const entry = survey?.history.find((candidate) => candidate.id === segments[3]);
      if (!visible || entry === undefined) return (problem(res, 404, "not-found"), true);
      res.writeHead(200, { "content-type": "application/json" }).end(entry.definition);
      return true;
    }
    case "GET surveys/:/theme":
      if (!visible) problem(res, 404, "not-found");
      else json(res, 200, survey.theme ?? {});
      return true;
    default:
      problem(res, 404, "not-found");
      return true;
  }
}

function listSurveys(store: SurveyStore, url: URL, res: ServerResponse, userId: string): void {
  const query = url.searchParams;
  const withTheme = query.get("include") === "theme";
  const postId = query.get("postId");
  const publishId = query.get("legacyPublishId");
  let items: StoredSurvey[];
  if (postId !== null || publishId !== null) {
    items = [...store.surveys.values()].filter(
      (survey) =>
        canSee(store, survey, userId) &&
        (postId === null || survey.postId === postId) &&
        (publishId === null || survey.legacyPublishId === publishId),
    );
    json(res, 200, {
      items: items.map((survey) => surveyJson(store, survey, userId, withTheme)),
      nextCursor: null,
    });
    return;
  }
  const project = query.get("project") ?? "personal";
  if (project !== "personal" && roleOf(store, userId, project) === undefined) {
    return problem(res, 404, "not-found");
  }
  const archived = query.get("archived") === "true";
  items = [...store.surveys.values()]
    .filter((survey) =>
      project === "personal"
        ? survey.projectId === null && survey.ownerUserId === userId
        : survey.projectId === project,
    )
    .filter((survey) => survey.archived === archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const start = Number(query.get("cursor") ?? "0");
  const size = store.surveyPageSize ?? Number(query.get("limit") ?? "50");
  const page = items.slice(start, start + size);
  json(res, 200, {
    items: page.map((survey) => surveyJson(store, survey, userId, withTheme)),
    nextCursor: start + size < items.length ? String(start + size) : null,
  });
}

function parseObject(request: RecordedRequest): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(request.body.toString());
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** `POST /legacy-files`: one multipart part `file`; a name `legacy-<n>` for each stored file. */
async function legacyUpload(
  store: SurveyStore,
  request: RecordedRequest,
  res: ServerResponse,
  userId: string,
): Promise<void> {
  let file: string | File | null = null;
  try {
    const form = await new Response(new Uint8Array(request.body), {
      headers: { "content-type": request.headers["content-type"] ?? "" },
    }).formData();
    file = form.get("file");
  } catch {
    // Not a form: no file.
  }
  if (file === null || typeof file === "string") return problem(res, 400, "bad-request");
  const legacyName = `legacy-${store.uploads.length + 1}`;
  store.uploads.push({ legacyName, fileName: file.name, bytes: file.size, userId });
  json(res, 201, { legacyName });
}
