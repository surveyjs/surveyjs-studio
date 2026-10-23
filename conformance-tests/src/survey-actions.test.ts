/**
 * `updateSurvey`, `deleteSurvey` and `cloneSurvey` against the legacy fixtures.
 *
 * The data is shared by all test files and never reset (the Azurite replica also keeps it between
 * runs), so every test creates its own surveys and changes only those. Writes go only to the
 * outsider's personal scope, the Engineering project and the admin's personal scope. The owner's
 * personal scope and the Marketing project are never written, and no fixture survey is changed:
 * the checks on fixtures are refusals, which write nothing.
 *
 * Never leave or create an archived survey in the outsider's Personal scope: e2e asserts it has
 * none (the replica is shared between this suite and e2e). Tests that archive (or whose cleanup
 * archives) therefore work in the admin's Personal scope or in Engineering. Cleanup is registered
 * with `onTestFinished` right after a survey is created, so it also runs when a test fails.
 */
import { describe, expect, it, onTestFinished } from "vitest";
import { GUID, call, codeOf, as, cleanUp, walkItems } from "./harness.js";
import { fixtureUsers } from "./sign-in.js";

const { owner, admin, outsider } = fixtureUsers;

const MARKETING = "55555555-0000-4000-8000-a00000000001";
const ENGINEERING = "55555555-0000-4000-8000-a00000000002";
const UNKNOWN_ID = "99999999-0000-4000-8000-a00000000099";

const fixture = {
  campaign: "22222222-0000-4000-8000-a00000000004",
  engineeringRetro: "22222222-0000-4000-8000-a00000000006",
  outsiderQuiz: "22222222-0000-4000-8000-a00000000007",
};

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
  settings: {
    publicResults: boolean;
    storeRespondentIp: boolean;
    /** Present on create, get, update and clone; `listSurveys` items leave it out. */
    privateResultQuestions?: string[];
  };
}

interface SurveyPage {
  items: Survey[];
  nextCursor: string | null;
}

/** Lets the clock move on, so the next update is strictly newer (SQL `datetime` keeps ~1/300 s). */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

type Headers = Record<string, string>;

/**
 * Creates a survey and registers its cleanup (archive, then delete) as `cleanupHeaders`, which
 * defaults to `headers`; `null` registers none (the outsider's Personal scope must never hold an
 * archived survey, so surveys made there stay active).
 */
async function created(
  headers: Headers,
  body: unknown = {},
  cleanupHeaders: Headers | null = headers,
): Promise<Survey> {
  const response = await call("POST", "/surveys", { headers, body });
  expect(response.status).toBe(201);
  const survey = (await response.json()) as Survey;
  if (cleanupHeaders) cleanUpAfterTest(cleanupHeaders, survey.id);
  return survey;
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

async function cloned(
  headers: Headers,
  id: string,
  body?: unknown,
  cleanupHeaders: Headers = headers,
): Promise<Survey> {
  const response = await clone(headers, id, body);
  expect(response.status).toBe(201);
  const copy = (await response.json()) as Survey;
  cleanUpAfterTest(cleanupHeaders, copy.id);
  expect(response.headers.get("location")).toBe(`/api/v1/surveys/${copy.id}`);
  return copy;
}

function cleanUpAfterTest(headers: Headers, id: string): void {
  onTestFinished(() => cleanUp(headers, id));
}

const listed = (headers: Headers, query: string): Promise<Survey[]> =>
  walkItems<Survey>("/surveys", `/surveys?${query}`, headers);

describe("updateSurvey", () => {
  it("renames, unpublishes, publishes, archives and restores", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers, { name: "Actions: states" });
    let before = survey;

    const states: [string, Record<string, unknown>, Partial<Survey>][] = [
      ["rename", { name: " Renamed (kept as sent) " }, { name: " Renamed (kept as sent) " }],
      // A new survey starts published.
      ["unpublish", { published: false }, { published: false }],
      ["publish", { published: true }, { published: true }],
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
  });

  it("changes one setting and keeps the other", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers, { name: "Actions: settings" });
    await tick();
    const first = await patched(headers, survey.id, { settings: { publicResults: true } });
    expect(first.settings).toEqual({
      publicResults: true,
      storeRespondentIp: false,
      privateResultQuestions: [],
    });
    await tick();
    const second = await patched(headers, survey.id, { settings: { storeRespondentIp: true } });
    expect(second.settings).toEqual({
      publicResults: true,
      storeRespondentIp: true,
      privateResultQuestions: [],
    });
    await tick();
    const third = await patched(headers, survey.id, { settings: { publicResults: false } });
    expect(third.settings).toEqual({
      publicResults: false,
      storeRespondentIp: true,
      privateResultQuestions: [],
    });
    expect(Date.parse(third.updatedAt)).toBeGreaterThan(Date.parse(first.updatedAt));
  });

  it("replaces the private-question list, keeps it across other patches and clears it", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers, { name: "Actions: private questions" });
    expect(survey.settings.privateResultQuestions).toEqual([]);
    await tick();
    const first = await patched(headers, survey.id, {
      settings: { privateResultQuestions: ["q2", "q1"] },
    });
    expect(first.settings).toEqual({
      publicResults: false,
      storeRespondentIp: false,
      privateResultQuestions: ["q2", "q1"],
    });
    expect(Date.parse(first.updatedAt)).toBeGreaterThan(Date.parse(survey.updatedAt));
    expect(await read(headers, survey.id)).toEqual(first);

    const second = await patched(headers, survey.id, { settings: { publicResults: true } });
    expect(second.settings).toEqual({
      publicResults: true,
      storeRespondentIp: false,
      privateResultQuestions: ["q2", "q1"],
    });

    // The list belongs to getSurvey and the writes; the list items leave it out.
    const listed = await call("GET", "/surveys", {
      path: "/surveys?project=personal&limit=200",
      headers,
    });
    const items = ((await listed.json()) as SurveyPage).items;
    const item = items.find(({ id }) => id === survey.id);
    expect(item).toBeDefined();
    expect(item?.settings).toEqual({ publicResults: true, storeRespondentIp: false });

    const cleared = await patched(headers, survey.id, { settings: { privateResultQuestions: [] } });
    expect(cleared.settings.privateResultQuestions).toEqual([]);
    expect((await read(headers, survey.id)).settings.privateResultQuestions).toEqual([]);
  });

  it("refuses an invalid private-question list with 422 validation-failed", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers, { name: "Actions: bad private questions" });
    const invalid: unknown[] = [
      [""],
      [1],
      ["a", "a"],
      "q1",
      Array.from({ length: 1001 }, (_, i) => `q${i}`),
    ];
    for (const list of invalid) {
      const response = await patch(headers, survey.id, {
        settings: { privateResultQuestions: list },
      });
      expect(response.status).toBe(422);
      expect(await codeOf(response)).toBe("validation-failed");
    }
    expect((await read(headers, survey.id)).settings.privateResultQuestions).toEqual([]);
  });

  it("returns the fixture survey's private questions from getSurvey", async (ctx) => {
    const survey = await read(await as(ctx, owner), "22222222-0000-4000-8000-a00000000001");
    expect(survey.settings.privateResultQuestions).toEqual(["receipt"]);
  });

  it("applies a combined patch at once, sent as application/json", async (ctx) => {
    const headers = await as(ctx, admin);
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
  });

  it("makes the mover the creator", async (ctx) => {
    const olivia = await as(ctx, owner);
    const adam = await as(ctx, admin);
    const survey = await created(
      olivia,
      { name: "Actions: creator", projectId: ENGINEERING },
      adam,
    );
    expect(survey.permissions.canModify).toBe(true);
    await patched(adam, survey.id, { projectId: null });
    await tick();
    await patched(adam, survey.id, { projectId: ENGINEERING });
    // Adam is now its creator; Olivia is a plain member of Engineering.
    expect((await read(olivia, survey.id)).permissions.canModify).toBe(false);
    expect((await read(adam, survey.id)).permissions.canModify).toBe(true);
  });

  it("changes nothing but updatedAt when moved to the current scope", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers, { name: "Actions: same scope" });
    await tick();
    const after = await patched(headers, survey.id, { projectId: null });
    expect(after).toEqual({ ...survey, updatedAt: after.updatedAt });
    expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(survey.updatedAt));
  });

  it("answers 422 for an empty patch and for invalid values", async (ctx) => {
    const headers = await as(ctx, admin);
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
  });

  it("answers 403 forbidden for a survey the user can see but not modify", async (ctx) => {
    const response = await patch(await as(ctx, owner), fixture.engineeringRetro, { name: "Mine" });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("forbidden");
  });

  it("answers 403 for a move to a project the user is not a member of", async (ctx) => {
    const headers = await as(ctx, outsider);
    // Stays active: an archived survey must not be left in the outsider's Personal scope.
    const survey = await created(headers, { name: "Actions: no membership" }, null);
    const response = await patch(headers, survey.id, { projectId: MARKETING });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("forbidden");
    expect((await read(headers, survey.id)).projectId).toBeNull();
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
    const headers = await as(ctx, admin);
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
  /** A survey of the admin's own to clone; the copy is archived in the admin's scope on cleanup. */
  async function source(headers: Headers): Promise<Survey> {
    return created(headers, { name: "Actions: clone source" });
  }

  it("copies a survey into the caller's scope as a published (as new), active survey", async (ctx) => {
    const headers = await as(ctx, admin);
    const original = await source(headers);
    await tick();
    const copy = await cloned(headers, original.id);

    expect(copy).toMatchObject({
      name: "Copy of Actions: clone source",
      projectId: null,
      published: true,
      archived: false,
      settings: { publicResults: false, storeRespondentIp: false },
      permissions: { canModify: true },
    });
    for (const id of [copy.id, copy.postId, copy.resultId]) expect(id).toMatch(GUID);
    expect(copy.id).not.toBe(original.id);
    expect(copy.postId).not.toBe(original.postId);
    expect(copy.resultId).not.toBe(original.resultId);
    expect(copy.createdAt).toBe(copy.updatedAt);
    expect(await read(headers, copy.id)).toEqual(copy);

    // The copy is listed, and before the source it is newer than.
    const active = await listed(headers, "project=personal&limit=200");
    const ids = active.map((s) => s.id);
    expect(ids).toContain(copy.id);
    expect(ids.indexOf(copy.id)).toBeLessThan(ids.indexOf(original.id));

    expect(await read(headers, original.id)).toEqual(original);
  });

  it("keeps a given name", async (ctx) => {
    const headers = await as(ctx, admin);
    const copy = await cloned(headers, (await source(headers)).id, { name: "Actions: given name" });
    expect(copy.name).toBe("Actions: given name");
  });

  it("puts a copy of a project survey in that project, with the caller as creator", async (ctx) => {
    const headers = await as(ctx, owner);
    // Olivia cannot modify the original, but she made the copy.
    expect((await read(headers, fixture.engineeringRetro)).permissions.canModify).toBe(false);
    // The copy is Olivia's own; the project admin archives and deletes it on cleanup.
    const copy = await cloned(headers, fixture.engineeringRetro, undefined, await as(ctx, admin));
    expect(copy).toMatchObject({
      name: "Copy of Engineering retro",
      projectId: ENGINEERING,
      // The source is unpublished; a copy is published, as a new survey.
      published: true,
      permissions: { canModify: true },
    });
  });

  it("puts a copy in the caller's Personal surveys for projectId null", async (ctx) => {
    const headers = await as(ctx, admin);
    const copy = await cloned(headers, fixture.engineeringRetro, { projectId: null });
    expect(copy.projectId).toBeNull();
    expect((await listed(headers, "project=personal&limit=200")).map((s) => s.id)).toContain(
      copy.id,
    );
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
