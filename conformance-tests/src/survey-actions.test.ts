/**
 * `updateSurvey`, `deleteSurvey` and `cloneSurvey` against the legacy fixtures.
 *
 * The data is shared by all test files and never reset (the Azurite replica also keeps it between
 * runs), so every test creates its own surveys and changes only those. Writes go only to the
 * outsider's personal scope, the Engineering project and the admin's personal scope. The owner's
 * personal scope and the Marketing project are never written, and no fixture survey is changed:
 * the checks on fixtures are refusals, which write nothing. What a test creates it archives and
 * deletes at the end where it can.
 */
import { describe, expect, it, type TestContext } from "vitest";
import { call, codeOf, sessionHeaders, signedIn } from "./harness.js";
import { fixtureUsers, type SignInResult } from "./sign-in.js";

const { owner, admin, outsider } = fixtureUsers;

const MARKETING = "55555555-0000-4000-8000-a00000000001";
const ENGINEERING = "55555555-0000-4000-8000-a00000000002";
const UNKNOWN_ID = "99999999-0000-4000-8000-a00000000099";

const fixture = {
  campaign: "22222222-0000-4000-8000-a00000000004",
  engineeringRetro: "22222222-0000-4000-8000-a00000000006",
  outsiderQuiz: "22222222-0000-4000-8000-a00000000007",
};

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MERGE_PATCH = "application/merge-patch+json";

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

/** Lets the clock move on, so the next update is strictly newer (SQL `datetime` keeps ~1/300 s). */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

type Headers = Record<string, string>;

async function created(headers: Headers, body: unknown = {}): Promise<Survey> {
  const response = await call("POST", "/surveys", { headers, body });
  expect(response.status).toBe(201);
  return (await response.json()) as Survey;
}

function get(headers: Headers, id: string): Promise<Response> {
  return call("GET", "/surveys/{surveyId}", { path: `/surveys/${id}`, headers });
}

async function read(headers: Headers, id: string): Promise<Survey> {
  const response = await get(headers, id);
  expect(response.status).toBe(200);
  return (await response.json()) as Survey;
}

/** PATCH as merge patch (default) or with another media type. */
function patch(
  headers: Headers,
  id: string,
  body: unknown,
  mediaType: string = MERGE_PATCH,
): Promise<Response> {
  return call("PATCH", "/surveys/{surveyId}", {
    path: `/surveys/${id}`,
    headers: { "content-type": mediaType, ...headers },
    body,
  });
}

async function patched(headers: Headers, id: string, body: unknown, mediaType?: string) {
  const response = await patch(headers, id, body, mediaType);
  expect(response.status).toBe(200);
  return (await response.json()) as Survey;
}

function remove(headers: Headers, id: string): Promise<Response> {
  return call("DELETE", "/surveys/{surveyId}", { path: `/surveys/${id}`, headers });
}

function clone(headers: Headers, id: string, body?: unknown): Promise<Response> {
  return call("POST", "/surveys/{surveyId}/clones", {
    path: `/surveys/${id}/clones`,
    headers,
    ...(body !== undefined && { body }),
  });
}

async function cloned(headers: Headers, id: string, body?: unknown): Promise<Survey> {
  const response = await clone(headers, id, body);
  expect(response.status).toBe(201);
  const copy = (await response.json()) as Survey;
  expect(response.headers.get("location")).toBe(`/api/v1/surveys/${copy.id}`);
  return copy;
}

/** Archives and deletes a survey the test created. */
async function cleanUp(headers: Headers, id: string): Promise<void> {
  await patched(headers, id, { archived: true });
  expect((await remove(headers, id)).status).toBe(204);
}

async function listed(headers: Headers, query: string): Promise<Survey[]> {
  const items: Survey[] = [];
  let cursor: string | null = null;
  do {
    const path = `/surveys?${query}${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
    const response = await call("GET", "/surveys", { path, headers });
    expect(response.status).toBe(200);
    const body = (await response.json()) as SurveyPage;
    items.push(...body.items);
    cursor = body.nextCursor;
  } while (cursor !== null);
  return items;
}

describe("updateSurvey", () => {
  it("renames, publishes, unpublishes, archives and restores", async (ctx) => {
    const headers = await as(ctx, outsider);
    const survey = await created(headers, { name: "Actions: states" });
    let before = survey;

    const states: [string, Record<string, unknown>, Partial<Survey>][] = [
      ["rename", { name: " Renamed (kept as sent) " }, { name: " Renamed (kept as sent) " }],
      ["publish", { published: true }, { published: true }],
      ["unpublish", { published: false }, { published: false }],
      ["archive", { archived: true }, { archived: true }],
      ["restore", { archived: false }, { archived: false }],
    ];
    for (const [step, body, expected] of states) {
      await tick();
      const after = await patched(headers, survey.id, body);
      expect(after, step).toMatchObject({ ...expected, id: survey.id, projectId: null });
      expect(Date.parse(after.updatedAt), step).toBeGreaterThan(Date.parse(before.updatedAt));
      expect(after.createdAt).toBe(survey.createdAt);
      expect(after.permissions.canModify).toBe(true);
      expect(await read(headers, survey.id)).toEqual(after);
      before = after;
    }
    await cleanUp(headers, survey.id);
  });

  it("changes one setting and keeps the other", async (ctx) => {
    const headers = await as(ctx, outsider);
    const survey = await created(headers, { name: "Actions: settings" });
    await tick();
    const first = await patched(headers, survey.id, { settings: { publicResults: true } });
    expect(first.settings).toEqual({ publicResults: true, storeRespondentIp: false });
    await tick();
    const second = await patched(headers, survey.id, { settings: { storeRespondentIp: true } });
    expect(second.settings).toEqual({ publicResults: true, storeRespondentIp: true });
    await tick();
    const third = await patched(headers, survey.id, { settings: { publicResults: false } });
    expect(third.settings).toEqual({ publicResults: false, storeRespondentIp: true });
    expect(Date.parse(third.updatedAt)).toBeGreaterThan(Date.parse(first.updatedAt));
    await cleanUp(headers, survey.id);
  });

  it("applies a combined patch at once, sent as application/json", async (ctx) => {
    const headers = await as(ctx, outsider);
    const survey = await created(headers, { name: "Actions: combined" });
    await tick();
    const after = await patched(
      headers,
      survey.id,
      { name: "Combined", published: true, archived: true, settings: { publicResults: true } },
      "application/json",
    );
    expect(after).toMatchObject({
      name: "Combined",
      published: true,
      archived: true,
      settings: { publicResults: true, storeRespondentIp: false },
    });
    expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(survey.updatedAt));
    await cleanUp(headers, survey.id);
  });

  it("moves a survey to the caller's Personal surveys and back", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers, { name: "Actions: move", projectId: ENGINEERING });
    await tick();
    const personal = await patched(headers, survey.id, { projectId: null });
    expect(personal.projectId).toBeNull();
    expect(personal.permissions.canModify).toBe(true);
    const inPersonal = await listed(headers, "project=personal&limit=200");
    expect(inPersonal.map((s) => s.id)).toContain(survey.id);
    expect(
      (await listed(headers, `project=${ENGINEERING}&limit=200`)).map((s) => s.id),
    ).not.toContain(survey.id);
    await tick();
    const back = await patched(headers, survey.id, { projectId: ENGINEERING });
    expect(back.projectId).toBe(ENGINEERING);
    expect((await listed(headers, `project=${ENGINEERING}&limit=200`)).map((s) => s.id)).toContain(
      survey.id,
    );
    await cleanUp(headers, survey.id);
  });

  it("makes the mover the creator", async (ctx) => {
    const olivia = await as(ctx, owner);
    const adam = await as(ctx, admin);
    const survey = await created(olivia, { name: "Actions: creator", projectId: ENGINEERING });
    expect(survey.permissions.canModify).toBe(true);
    await patched(adam, survey.id, { projectId: null });
    await tick();
    await patched(adam, survey.id, { projectId: ENGINEERING });
    // Adam is now its creator; Olivia is a plain member of Engineering.
    expect((await read(olivia, survey.id)).permissions.canModify).toBe(false);
    expect((await read(adam, survey.id)).permissions.canModify).toBe(true);
    await cleanUp(adam, survey.id);
  });

  it("changes nothing but updatedAt when moved to the current scope", async (ctx) => {
    const headers = await as(ctx, outsider);
    const survey = await created(headers, { name: "Actions: same scope" });
    await tick();
    const after = await patched(headers, survey.id, { projectId: null });
    expect(after).toEqual({ ...survey, updatedAt: after.updatedAt });
    expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(survey.updatedAt));
    await cleanUp(headers, survey.id);
  });

  it("answers 422 for an empty patch and for invalid values", async (ctx) => {
    const headers = await as(ctx, outsider);
    const survey = await created(headers, { name: "Actions: invalid" });
    const invalid: unknown[] = [
      {},
      { name: "" },
      { name: "   " },
      { name: "x".repeat(201) },
      { name: null },
      { archived: "yes" },
    ];
    for (const body of invalid) {
      const response = await patch(headers, survey.id, body);
      expect(response.status, JSON.stringify(body)).toBe(422);
      expect(await codeOf(response)).toBe("validation-failed");
    }
    expect(await read(headers, survey.id)).toEqual(survey);
    await cleanUp(headers, survey.id);
  });

  it("answers 403 forbidden for a survey the user can see but not modify", async (ctx) => {
    const response = await patch(await as(ctx, owner), fixture.engineeringRetro, { name: "Mine" });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("forbidden");
  });

  it("answers 403 for a move to a project the user is not a member of", async (ctx) => {
    const headers = await as(ctx, outsider);
    const survey = await created(headers, { name: "Actions: no membership" });
    const response = await patch(headers, survey.id, { projectId: MARKETING });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("forbidden");
    expect((await read(headers, survey.id)).projectId).toBeNull();
    await cleanUp(headers, survey.id);
  });

  it("answers 404 for another user's survey and for an unknown id", async (ctx) => {
    const headers = await as(ctx, outsider);
    for (const id of [fixture.campaign, UNKNOWN_ID]) {
      const response = await patch(headers, id, { name: "x" });
      expect(response.status, id).toBe(404);
      expect(await codeOf(response)).toBe("not-found");
    }
  });

  it("answers 400 for malformed JSON", async (ctx) => {
    const headers = await as(ctx, outsider);
    const response = await call("PATCH", "/surveys/{surveyId}", {
      path: `/surveys/${fixture.outsiderQuiz}`,
      headers: { "content-type": MERGE_PATCH, ...headers },
      rawBody: '{"name": ',
    });
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("bad-request");
  });

  it("answers 403 csrf-token-invalid without the CSRF token", async (ctx) => {
    const { cookie = "" } = await as(ctx, outsider);
    const response = await patch({ cookie }, fixture.outsiderQuiz, { name: "x" });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("csrf-token-invalid");
  });
});

describe("deleteSurvey", () => {
  it("deletes an archived survey and answers 204 with an empty body", async (ctx) => {
    const headers = await as(ctx, outsider);
    const survey = await created(headers, { name: "Actions: delete" });

    const active = await remove(headers, survey.id);
    expect(active.status).toBe(409);
    expect(await codeOf(active)).toBe("survey-not-archived");
    expect((await read(headers, survey.id)).id).toBe(survey.id);

    await patched(headers, survey.id, { archived: true });
    const deleted = await remove(headers, survey.id);
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");

    expect((await get(headers, survey.id)).status).toBe(404);
    const again = await remove(headers, survey.id);
    expect(again.status).toBe(404);
    expect(await codeOf(again)).toBe("not-found");
  });

  it("answers 403 for a survey the user can see but not modify", async (ctx) => {
    const olivia = await as(ctx, owner);
    const adam = await as(ctx, admin);
    const survey = await created(adam, { name: "Actions: not yours", projectId: ENGINEERING });
    await patched(adam, survey.id, { archived: true });
    const response = await remove(olivia, survey.id);
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("forbidden");
    expect((await remove(adam, survey.id)).status).toBe(204);
  });

  it("answers 404 for another user's survey and for an unknown id", async (ctx) => {
    const headers = await as(ctx, outsider);
    for (const id of [fixture.campaign, UNKNOWN_ID]) {
      const response = await remove(headers, id);
      expect(response.status, id).toBe(404);
      expect(await codeOf(response)).toBe("not-found");
    }
  });

  it("answers 403 csrf-token-invalid without the CSRF token", async (ctx) => {
    const { cookie = "" } = await as(ctx, outsider);
    const response = await remove({ cookie }, fixture.outsiderQuiz);
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("csrf-token-invalid");
  });
});

describe("cloneSurvey", () => {
  it("copies a survey into the caller's scope as an unpublished, active survey", async (ctx) => {
    const headers = await as(ctx, outsider);
    const source = await read(headers, fixture.outsiderQuiz);
    const copy = await cloned(headers, fixture.outsiderQuiz);

    expect(copy).toMatchObject({
      name: "Copy of Outsider quiz",
      projectId: null,
      published: false,
      archived: false,
      settings: { publicResults: false, storeRespondentIp: false },
      permissions: { canModify: true },
    });
    for (const id of [copy.id, copy.postId, copy.resultId]) expect(id).toMatch(GUID);
    expect(copy.id).not.toBe(source.id);
    expect(copy.postId).not.toBe(source.postId);
    expect(copy.resultId).not.toBe(source.resultId);
    expect(copy.createdAt).toBe(copy.updatedAt);
    expect(await read(headers, copy.id)).toEqual(copy);

    // The copy is listed, and before the source it is newer than.
    const active = await listed(headers, "project=personal&limit=200");
    const ids = active.map((s) => s.id);
    expect(ids).toContain(copy.id);
    expect(ids.indexOf(copy.id)).toBeLessThan(ids.indexOf(source.id));

    expect(await read(headers, fixture.outsiderQuiz)).toEqual(source);
    await cleanUp(headers, copy.id);
  });

  it("keeps a given name", async (ctx) => {
    const headers = await as(ctx, outsider);
    const copy = await cloned(headers, fixture.outsiderQuiz, { name: "Actions: given name" });
    expect(copy.name).toBe("Actions: given name");
    await cleanUp(headers, copy.id);
  });

  it("puts a copy of a project survey in that project, with the caller as creator", async (ctx) => {
    const headers = await as(ctx, owner);
    // Olivia cannot modify the original, but she made the copy.
    expect((await read(headers, fixture.engineeringRetro)).permissions.canModify).toBe(false);
    const copy = await cloned(headers, fixture.engineeringRetro);
    expect(copy).toMatchObject({
      name: "Copy of Engineering retro",
      projectId: ENGINEERING,
      permissions: { canModify: true },
    });
    await cleanUp(headers, copy.id);
  });

  it("puts a copy in the caller's Personal surveys for projectId null", async (ctx) => {
    const headers = await as(ctx, admin);
    const copy = await cloned(headers, fixture.engineeringRetro, { projectId: null });
    expect(copy.projectId).toBeNull();
    expect((await listed(headers, "project=personal&limit=200")).map((s) => s.id)).toContain(
      copy.id,
    );
    await cleanUp(headers, copy.id);
  });

  it("answers 403 for a target project the user is not a member of", async (ctx) => {
    const response = await clone(await as(ctx, outsider), fixture.outsiderQuiz, {
      projectId: MARKETING,
    });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("forbidden");
  });

  it("answers 404 for another user's survey and for an unknown id", async (ctx) => {
    const headers = await as(ctx, outsider);
    for (const id of [fixture.campaign, UNKNOWN_ID]) {
      const response = await clone(headers, id);
      expect(response.status, id).toBe(404);
      expect(await codeOf(response)).toBe("not-found");
    }
  });

  it("answers 422 for a blank or a too long name", async (ctx) => {
    const headers = await as(ctx, outsider);
    for (const name of ["", "x".repeat(201)]) {
      const response = await clone(headers, fixture.outsiderQuiz, { name });
      expect(response.status, name.length.toString()).toBe(422);
      expect(await codeOf(response)).toBe("validation-failed");
    }
  });

  it("answers 400 for malformed JSON", async (ctx) => {
    const headers = await as(ctx, outsider);
    const response = await call("POST", "/surveys/{surveyId}/clones", {
      path: `/surveys/${fixture.outsiderQuiz}/clones`,
      headers,
      rawBody: '{"name": ',
    });
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("bad-request");
  });

  it("answers 403 csrf-token-invalid without the CSRF token", async (ctx) => {
    const { cookie = "" } = await as(ctx, outsider);
    const response = await clone({ cookie }, fixture.outsiderQuiz);
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("csrf-token-invalid");
  });
});
