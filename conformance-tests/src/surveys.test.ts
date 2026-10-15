/**
 * `listSurveys`, `createSurvey` and `getSurvey` against the legacy fixtures.
 *
 * The Azurite replica keeps data between runs, so tests that create surveys do so only in the
 * outsider's personal scope or in the Engineering project, and assertions never assume the exact
 * size of those scopes: they check membership, relative order and computed expectations, walking
 * every page. The owner's personal scope and the Marketing project are never written.
 */
import { describe, expect, it, type TestContext } from "vitest";
import { call, codeOf, sessionHeaders, signedIn } from "./harness.js";
import { fixtureUsers, type SignInResult } from "./sign-in.js";

const { owner, admin, member, outsider } = fixtureUsers;

const MARKETING = "55555555-0000-4000-8000-a00000000001";
const ENGINEERING = "55555555-0000-4000-8000-a00000000002";
const UNKNOWN_ID = "99999999-0000-4000-8000-a00000000099";

/** Survey ids of the fixtures. */
const fixture = {
  customerFeedback: "22222222-0000-4000-8000-a00000000001",
  draftIdea: "22222222-0000-4000-8000-a00000000002",
  oldPoll: "22222222-0000-4000-8000-a00000000003",
  campaign: "22222222-0000-4000-8000-a00000000004",
  archivedCampaign: "22222222-0000-4000-8000-a00000000005",
  engineeringRetro: "22222222-0000-4000-8000-a00000000006",
  outsiderQuiz: "22222222-0000-4000-8000-a00000000007",
  apiCreated: "22222222-0000-4000-8000-a00000000008",
};

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Survey {
  id: string;
  name: string;
  projectId: string | null;
  published: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  postId: string;
  resultId: string;
  permissions: { canModify: boolean };
  settings: { publicResults: boolean; storeRespondentIp: boolean };
}

interface SurveyPage {
  items: Survey[];
  nextCursor: string | null;
}

type ListQuery = Record<string, string | number | boolean>;

const sessions = new Map<string, SignInResult>();

/** Request headers of the user's browser; signs in once per user and test file. */
async function as(ctx: TestContext, user: { id: string }): Promise<Record<string, string>> {
  let session = sessions.get(user.id);
  if (!session) {
    session = await signedIn(ctx, user.id);
    expect(session.callback.status).toBe(302);
    sessions.set(user.id, session);
  }
  return sessionHeaders(session);
}

function listPath(query: ListQuery): string {
  const text = new URLSearchParams(
    Object.entries(query).map(([name, value]): [string, string] => [name, String(value)]),
  ).toString();
  return text === "" ? "/surveys" : `/surveys?${text}`;
}

function list(headers: Record<string, string>, query: ListQuery = {}): Promise<Response> {
  return call("GET", "/surveys", { path: listPath(query), headers });
}

async function page(headers: Record<string, string>, query: ListQuery = {}): Promise<SurveyPage> {
  const response = await list(headers, query);
  expect(response.status).toBe(200);
  return (await response.json()) as SurveyPage;
}

/** Negative when `a` comes first in list order: updatedAt newest first, then id (code points). */
function listOrder(a: Survey, b: Survey): number {
  const byTime = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  if (byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Strictly in list order, so also without duplicates. */
function expectSorted(items: readonly Survey[]): void {
  for (let i = 1; i < items.length; i += 1) {
    const [before, after] = [items[i - 1], items[i]];
    if (before && after) {
      expect(listOrder(before, after), `${before.id} before ${after.id}`).toBeLessThan(0);
    }
  }
}

/** Every page of a list, each checked for order, and the whole list checked again. */
async function walk(headers: Record<string, string>, query: ListQuery = {}): Promise<Survey[]> {
  const all: Survey[] = [];
  let cursor: string | null = null;
  for (let pages = 1; ; pages += 1) {
    if (pages > 1000) throw new Error("the list does not end");
    const current = await page(headers, { ...query, ...(cursor !== null && { cursor }) });
    if (query.limit !== undefined) {
      expect(current.items.length).toBeLessThanOrEqual(Number(query.limit));
    }
    expectSorted(current.items);
    all.push(...current.items);
    if (current.nextCursor === null) break;
    cursor = current.nextCursor;
  }
  expectSorted(all);
  return all;
}

const idsOf = (items: readonly Survey[]): string[] => items.map((item) => item.id);

function find(items: readonly Survey[], id: string): Survey {
  const found = items.find((item) => item.id === id);
  expect(found, `survey ${id} is listed`).toBeDefined();
  return found as Survey;
}

async function create(headers: Record<string, string>, body?: unknown): Promise<Response> {
  return call("POST", "/surveys", { headers, ...(body !== undefined && { body }) });
}

async function created(headers: Record<string, string>, body?: unknown): Promise<Survey> {
  const response = await create(headers, body);
  expect(response.status).toBe(201);
  return (await response.json()) as Survey;
}

/**
 * Lets the clock move on, so the next survey is strictly newer than every earlier one (the legacy
 * SQL `datetime` keeps about 1/300 s).
 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * The highest N among names of the form "New Survey N", or 0. Names count as the server reads them:
 * "New Survey", then an integer up to 2147483647, optionally signed and padded with white space.
 */
function highestNewSurveyNumber(names: readonly string[]): number {
  let highest = 0;
  for (const name of names) {
    if (!name.startsWith("New Survey")) continue;
    const suffix = name.slice("New Survey".length);
    if (!/^[\t\n\v\f\r ]*[+-]?[0-9]+[\t\n\v\f\r ]*$/.test(suffix)) continue;
    const value = Number(suffix.trim());
    if (value <= 2147483647 && value > highest) highest = value;
  }
  return highest;
}

describe("listSurveys", () => {
  it("answers 401 unauthenticated when signed out", async () => {
    const response = await list({});
    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("unauthenticated");
  });

  it("lists the user's active personal surveys by default, newest first", async (ctx) => {
    const items = await walk(await as(ctx, owner));
    const ids = idsOf(items);
    const order = [fixture.apiCreated, fixture.customerFeedback, fixture.draftIdea].map((id) =>
      ids.indexOf(id),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(ids).not.toContain(fixture.oldPoll);
    expect(items.every((item) => !item.archived && item.projectId === null)).toBe(true);
    expect(find(items, fixture.customerFeedback)).toEqual({
      id: fixture.customerFeedback,
      name: "Customer feedback",
      projectId: null,
      published: true,
      archived: false,
      createdAt: "2026-03-13T09:12:00.000Z",
      updatedAt: "2026-04-14T15:30:00.000Z",
      postId: "33333333-0000-4000-8000-a00000000001",
      resultId: "44444444-0000-4000-8000-a00000000001",
      permissions: { canModify: true },
      settings: { publicResults: true, storeRespondentIp: true },
    });
  });

  it("lists archived surveys with archived=true", async (ctx) => {
    const items = await walk(await as(ctx, owner), { archived: true });
    const ids = idsOf(items);
    expect(ids).toContain(fixture.oldPoll);
    for (const active of [fixture.apiCreated, fixture.customerFeedback, fixture.draftIdea]) {
      expect(ids).not.toContain(active);
    }
    expect(items.every((item) => item.archived)).toBe(true);
  });

  it("a member lists a project's surveys; canModify follows the creator", async (ctx) => {
    const headers = await as(ctx, member);
    const active = await walk(headers, { project: MARKETING });
    expect(find(active, fixture.campaign)).toMatchObject({
      projectId: MARKETING,
      permissions: { canModify: true },
    });
    expect(idsOf(active)).not.toContain(fixture.archivedCampaign);
    const archived = await walk(headers, { project: MARKETING, archived: true });
    expect(find(archived, fixture.archivedCampaign)).toMatchObject({
      projectId: MARKETING,
      archived: true,
      permissions: { canModify: false },
    });
  });

  it("a project admin may modify every survey of the project", async (ctx) => {
    const headers = await as(ctx, admin);
    const active = await walk(headers, { project: MARKETING });
    expect(find(active, fixture.campaign).permissions.canModify).toBe(true);
    const archived = await walk(headers, { project: MARKETING, archived: true });
    expect(find(archived, fixture.archivedCampaign).permissions.canModify).toBe(true);
  });

  it("a plain member may not modify a survey someone else created", async (ctx) => {
    const items = await walk(await as(ctx, owner), { project: ENGINEERING });
    expect(find(items, fixture.engineeringRetro)).toMatchObject({
      name: "Engineering retro",
      projectId: ENGINEERING,
      permissions: { canModify: false },
    });
  });

  it("answers 404 not-found for a project the user is not a member of", async (ctx) => {
    const response = await list(await as(ctx, outsider), { project: MARKETING });
    expect(response.status).toBe(404);
    expect(await codeOf(response)).toBe("not-found");
  });

  it("answers 404 not-found for an unknown project and for text that is no id", async (ctx) => {
    const headers = await as(ctx, owner);
    for (const project of [UNKNOWN_ID, "nonsense"]) {
      const response = await list(headers, { project });
      expect(response.status).toBe(404);
      expect(await codeOf(response)).toBe("not-found");
    }
  });

  it("answers 400 bad-request for an invalid cursor, limit or archived value", async (ctx) => {
    const headers = await as(ctx, owner);
    const { nextCursor } = await page(headers, { limit: 1 });
    expect(nextCursor).toEqual(expect.any(String));
    const personalCursor = String(nextCursor);
    const queries: ListQuery[] = [
      { cursor: "abc" },
      // A cursor belongs to one list: its scope and its archived state.
      { project: MARKETING, cursor: personalCursor },
      { archived: true, cursor: personalCursor },
      { limit: 0 },
      { limit: 201 },
      { archived: "maybe" },
    ];
    for (const query of queries) {
      const response = await list(headers, query);
      expect(response.status, JSON.stringify(query)).toBe(400);
      expect(await codeOf(response)).toBe("bad-request");
    }
  });
});

describe("paging (outsider's personal scope)", () => {
  it("walks every survey once, in order, to a null cursor", async (ctx) => {
    const headers = await as(ctx, outsider);
    const made: string[] = [];
    for (let i = 1; i <= 5; i += 1) made.push((await created(headers, { name: `Paging ${i}` })).id);
    const items = await walk(headers, { limit: 2 });
    const ids = idsOf(items);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [...made, fixture.outsiderQuiz]) expect(ids).toContain(id);
  });

  it("a cursor keeps its place when a survey is created between pages", async (ctx) => {
    const headers = await as(ctx, outsider);
    // At least three surveys, so a second page exists.
    for (let i = 1; i <= 3; i += 1) await created(headers, { name: `Stable ${i}` });
    const first = await page(headers, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    await tick();
    const newer = await created(headers, { name: "Created between pages" });
    const second = await page(headers, { limit: 2, cursor: String(first.nextCursor) });
    const secondIds = idsOf(second.items);
    expect(second.items.length).toBeGreaterThan(0);
    for (const id of idsOf(first.items)) expect(secondIds).not.toContain(id);
    expect(secondIds).not.toContain(newer.id);
    expectSorted([...first.items, ...second.items]);
  });
});

describe("createSurvey", () => {
  it("answers 401 unauthenticated when signed out", async () => {
    const response = await create({});
    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("unauthenticated");
  });

  it("creates a personal survey without a body", async (ctx) => {
    const headers = await as(ctx, outsider);
    await tick();
    const response = await create(headers);
    expect(response.status).toBe(201);
    const survey = (await response.json()) as Survey;
    expect(response.headers.get("location")).toBe(`/api/v1/surveys/${survey.id}`);
    expect(survey).toMatchObject({
      projectId: null,
      published: false,
      archived: false,
      permissions: { canModify: true },
      settings: { publicResults: false, storeRespondentIp: false },
    });
    expect(survey.name).toMatch(/^New Survey \d+$/);
    expect(survey.updatedAt).toBe(survey.createdAt);
    for (const id of [survey.id, survey.postId, survey.resultId]) expect(id).toMatch(GUID);
    expect(new Set([survey.id, survey.postId, survey.resultId]).size).toBe(3);

    const read = await call("GET", "/surveys/{surveyId}", {
      path: `/surveys/${survey.id}`,
      headers,
    });
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(survey);

    const first = (await page(headers)).items[0];
    expect(first?.id).toBe(survey.id);
  });

  it("names a survey one past the highest New Survey N of the scope", async (ctx) => {
    const headers = await as(ctx, outsider);
    const names = (await walk(headers)).map((item) => item.name);
    const highest = highestNewSurveyNumber(names);
    const explicit = await created(headers, { name: `New Survey ${highest + 10}` });
    expect(explicit.name).toBe(`New Survey ${highest + 10}`);
    const next = await created(headers);
    expect(next.name).toBe(`New Survey ${highest + 11}`);
  });

  it("keeps a given name as sent", async (ctx) => {
    const name = "  Quarterly check-in: «Q3» ";
    const survey = await created(await as(ctx, outsider), { name });
    expect(survey.name).toBe(name);
  });

  it("creates a project survey for a member, which the project's admin sees", async (ctx) => {
    const survey = await created(await as(ctx, owner), {
      name: "Owner's Engineering survey",
      projectId: ENGINEERING,
    });
    expect(survey).toMatchObject({ projectId: ENGINEERING, permissions: { canModify: true } });
    const items = await walk(await as(ctx, admin), { project: ENGINEERING });
    expect(find(items, survey.id)).toMatchObject({
      name: "Owner's Engineering survey",
      permissions: { canModify: true },
    });
  });

  it("answers 403 forbidden for a project the user is not a member of", async (ctx) => {
    const response = await create(await as(ctx, outsider), { projectId: MARKETING });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("forbidden");
  });

  it("answers 422 validation-failed for an invalid name or definition", async (ctx) => {
    const headers = await as(ctx, outsider);
    const cases: [unknown, string][] = [
      [{ name: "" }, "/name"],
      [{ name: "x".repeat(201) }, "/name"],
      [{ name: "   " }, "/name"],
      [{ definition: "x" }, "/definition"],
    ];
    for (const [body, pointer] of cases) {
      const response = await create(headers, body);
      expect(response.status, JSON.stringify(body)).toBe(422);
      const problem = (await response.json()) as { code: string; errors?: { pointer: string }[] };
      expect(problem.code).toBe("validation-failed");
      expect(problem.errors?.map((error) => error.pointer)).toContain(pointer);
    }
  });

  it("answers 400 bad-request for malformed JSON", async (ctx) => {
    const response = await call("POST", "/surveys", {
      headers: await as(ctx, outsider),
      rawBody: '{"name": ',
    });
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("bad-request");
  });

  it("answers 403 csrf-token-invalid without the CSRF token", async (ctx) => {
    const { cookie = "" } = await as(ctx, outsider);
    const response = await create({ cookie }, { name: "No token" });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("csrf-token-invalid");
  });
});

describe("getSurvey", () => {
  function get(headers: Record<string, string>, id: string): Promise<Response> {
    return call("GET", "/surveys/{surveyId}", { path: `/surveys/${id}`, headers });
  }

  it("answers the user's own survey", async (ctx) => {
    const response = await get(await as(ctx, owner), fixture.customerFeedback);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: fixture.customerFeedback,
      name: "Customer feedback",
      projectId: null,
      permissions: { canModify: true },
    });
  });

  it("answers a project survey to a member", async (ctx) => {
    const response = await get(await as(ctx, member), fixture.archivedCampaign);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      name: "Archived campaign",
      projectId: MARKETING,
      permissions: { canModify: false },
    });
  });

  it("answers 404 not-found for another user's survey and for an unknown id", async (ctx) => {
    const headers = await as(ctx, outsider);
    for (const id of [fixture.customerFeedback, fixture.campaign, UNKNOWN_ID]) {
      const response = await get(headers, id);
      expect(response.status, id).toBe(404);
      expect(await codeOf(response)).toBe("not-found");
    }
  });

  it("answers 400 bad-request for an id longer than 64 characters", async (ctx) => {
    const response = await get(await as(ctx, owner), "x".repeat(65));
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("bad-request");
  });

  it("answers 401 unauthenticated when signed out", async () => {
    const response = await get({}, fixture.customerFeedback);
    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("unauthenticated");
  });
});
