/**
 * The survey definition, theme and history operations against the legacy fixtures.
 *
 * The data is shared by all test files and never reset (the Azurite replica also keeps it between
 * runs), so every test creates its own surveys, in the admin's Personal scope, and saves only to
 * those. The owner's personal scope, Marketing and the outsider's Personal scope are never written
 * to, and no fixture survey is changed: the checks on fixtures are reads and refused writes
 * (the 403 on Engineering retro, the 404s for the outsider), which write nothing. Cleanup (archive,
 * then delete) is registered with `onTestFinished` right after a survey is created.
 */
import { describe, expect, it, onTestFinished, type TestContext } from "vitest";
import { call, codeOf, sessionHeaders, signedIn } from "./harness.js";
import { fixtureUsers, type SignInResult } from "./sign-in.js";

const { owner, admin, outsider } = fixtureUsers;

const UNKNOWN_ID = "99999999-0000-4000-8000-a00000000099";

const fixture = {
  feedback: "22222222-0000-4000-8000-a00000000001",
  campaign: "22222222-0000-4000-8000-a00000000004",
  engineeringRetro: "22222222-0000-4000-8000-a00000000006",
};

type Headers = Record<string, string>;

interface Survey {
  id: string;
  updatedAt: string;
}

interface HistoryEntry {
  at: string;
  user: { id: string; displayName: string } | null;
}

interface HistoryPage {
  items: HistoryEntry[];
  nextCursor: string | null;
}

const sessions = new Map<string, SignInResult>();

/** Request headers of the user's browser; signs in once per user and test file. */
async function as(ctx: TestContext, user: { id: string }): Promise<Headers> {
  let session = sessions.get(user.id);
  if (!session) {
    session = await signedIn(ctx, user.id);
    expect(session.callback.status).toBe(302);
    sessions.set(user.id, session);
  }
  return sessionHeaders(session);
}

/** Lets the clock move on, so the next save is strictly newer (SQL `datetime` keeps ~1/300 s). */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

/** Archives and deletes a survey the test created; a survey that is already gone is fine. */
async function cleanUp(headers: Headers, id: string): Promise<void> {
  const archived = await call("PATCH", "/surveys/{surveyId}", {
    path: `/surveys/${id}`,
    headers: { "content-type": "application/merge-patch+json", ...headers },
    body: { archived: true },
  });
  if (archived.status === 404) return;
  expect(archived.status).toBe(200);
  const deleted = await call("DELETE", "/surveys/{surveyId}", { path: `/surveys/${id}`, headers });
  expect([204, 404]).toContain(deleted.status);
}

/** Creates a survey and registers its cleanup. */
async function created(headers: Headers, body: unknown = {}): Promise<Survey> {
  const response = await call("POST", "/surveys", { headers, body });
  expect(response.status).toBe(201);
  const survey = (await response.json()) as Survey;
  onTestFinished(() => cleanUp(headers, survey.id));
  return survey;
}

async function readSurvey(headers: Headers, id: string): Promise<Survey> {
  const response = await call("GET", "/surveys/{surveyId}", { path: `/surveys/${id}`, headers });
  expect(response.status).toBe(200);
  return (await response.json()) as Survey;
}

type Document = "definition" | "theme";

const getPath = (document: Document) =>
  document === "definition" ? "/surveys/{surveyId}/definition" : "/surveys/{surveyId}/theme";

function getDocument(headers: Headers, id: string, document: Document): Promise<Response> {
  return call("GET", getPath(document), { path: `/surveys/${id}/${document}`, headers });
}

function putDocument(
  headers: Headers,
  id: string,
  document: Document,
  options: { body?: unknown; rawBody?: string; ifMatch?: string },
): Promise<Response> {
  const { ifMatch, ...payload } = options;
  return call("PUT", getPath(document), {
    path: `/surveys/${id}/${document}`,
    headers: { ...headers, ...(ifMatch !== undefined && { "if-match": ifMatch }) },
    ...payload,
  });
}

async function etagOf(response: Response): Promise<string> {
  const etag = response.headers.get("etag");
  expect(etag).toMatch(/^"[^"]+"$/);
  return etag ?? "";
}

/** Every history entry of a survey, newest first, read with the largest page. */
async function history(headers: Headers, id: string): Promise<HistoryEntry[]> {
  const response = await call("GET", "/surveys/{surveyId}/history", {
    path: `/surveys/${id}/history?limit=200`,
    headers,
  });
  expect(response.status).toBe(200);
  const page = (await response.json()) as HistoryPage;
  expect(page.nextCursor).toBeNull();
  return page.items;
}

describe.each(["definition", "theme"] as const)("the survey %s", (document) => {
  const content = (title: string) =>
    document === "definition" ? { title, pages: [] } : { themeName: title, cssVariables: {} };

  it("is read with an ETag, saved with it and then has a new ETag", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers);
    const before = await getDocument(headers, survey.id, document);
    expect(before.status).toBe(200);
    const beforeTag = await etagOf(before);
    const saved = await putDocument(headers, survey.id, document, {
      body: content("One"),
      ifMatch: beforeTag,
    });
    expect(saved.status).toBe(204);
    const afterTag = await etagOf(saved);
    expect(afterTag).not.toBe(beforeTag);

    const after = await getDocument(headers, survey.id, document);
    expect(await after.json()).toEqual(content("One"));
    expect(await etagOf(after)).toBe(afterTag);
  });

  it("answers 412 edit-conflict when saved with a stale ETag", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers);
    const firstTag = await etagOf(await getDocument(headers, survey.id, document));
    const saved = await putDocument(headers, survey.id, document, {
      body: content("One"),
      ifMatch: firstTag,
    });
    expect(saved.status).toBe(204);

    const stale = await putDocument(headers, survey.id, document, {
      body: content("Two"),
      ifMatch: firstTag,
    });
    expect(stale.status).toBe(412);
    expect(await codeOf(stale)).toBe("edit-conflict");
    const read = await getDocument(headers, survey.id, document);
    expect(await read.json()).toEqual(content("One"));
  });

  it("answers 428 if-match-required without If-Match", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers);
    const response = await putDocument(headers, survey.id, document, { body: content("One") });
    expect(response.status).toBe(428);
    expect(await codeOf(response)).toBe("if-match-required");
  });

  it("accepts If-Match: * and refuses a weak tag", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers);
    const tag = await etagOf(await getDocument(headers, survey.id, document));

    const weak = await putDocument(headers, survey.id, document, {
      body: content("One"),
      ifMatch: `W/${tag}`,
    });
    expect(weak.status).toBe(412);
    expect(await codeOf(weak)).toBe("edit-conflict");

    const any = await putDocument(headers, survey.id, document, {
      body: content("Two"),
      ifMatch: "*",
    });
    expect(any.status).toBe(204);
    expect(await (await getDocument(headers, survey.id, document)).json()).toEqual(content("Two"));
  });

  it("moves updatedAt on a save", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers);
    await tick();
    const tag = await etagOf(await getDocument(headers, survey.id, document));
    const saved = await putDocument(headers, survey.id, document, {
      body: content("One"),
      ifMatch: tag,
    });
    expect(saved.status).toBe(204);
    const { updatedAt } = await readSurvey(headers, survey.id);
    expect(Date.parse(updatedAt)).toBeGreaterThan(Date.parse(survey.updatedAt));
  });

  it("answers 403 forbidden for a member who cannot modify the survey", async (ctx) => {
    const headers = await as(ctx, owner);
    const response = await putDocument(headers, fixture.engineeringRetro, document, {
      body: content("Mine"),
      ifMatch: "*",
    });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("forbidden");
  });

  it("answers 404 for a survey the user cannot see and for an unknown id", async (ctx) => {
    const headers = await as(ctx, outsider);
    for (const id of [fixture.campaign, UNKNOWN_ID]) {
      const read = await getDocument(headers, id, document);
      expect(read.status).toBe(404);
      expect(await codeOf(read)).toBe("not-found");
      const write = await putDocument(headers, id, document, {
        body: content("Mine"),
        ifMatch: "*",
      });
      expect(write.status).toBe(404);
    }
  });

  it("answers 403 csrf-token-invalid without the CSRF header", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers);
    const response = await putDocument({ cookie: headers.cookie ?? "" }, survey.id, document, {
      body: content("One"),
      ifMatch: "*",
    });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("csrf-token-invalid");
  });

  it("answers 422 for a body that is not an object", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers);
    const response = await putDocument(headers, survey.id, document, { body: [], ifMatch: "*" });
    expect(response.status).toBe(422);
    expect(await codeOf(response)).toBe("validation-failed");
  });

  it("answers 400 for malformed JSON", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers);
    const response = await putDocument(headers, survey.id, document, {
      rawBody: "{not json",
      ifMatch: "*",
    });
    expect(response.status).toBe(400);
  });

  it("answers 413 payload-too-large for a body over limits.maxDocumentBytes", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers);
    const config = await call("GET", "/config");
    const { limits } = (await config.json()) as { limits: { maxDocumentBytes: number } };
    const overhead = '{"a":""}'.length;
    const rawBody = `{"a":"${"x".repeat(limits.maxDocumentBytes + 1 - overhead)}"}`;
    expect(Buffer.byteLength(rawBody)).toBe(limits.maxDocumentBytes + 1);
    const response = await putDocument(headers, survey.id, document, { rawBody, ifMatch: "*" });
    expect(response.status).toBe(413);
    expect(await codeOf(response)).toBe("payload-too-large");
  });
});

describe("the survey theme", () => {
  it("is {} at first and returns what was saved", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers);
    const first = await getDocument(headers, survey.id, "theme");
    expect(await first.json()).toEqual({});
    const theme = { themeName: "default", cssVariables: { "--sjs-general-backcolor": "#fff" } };
    const saved = await putDocument(headers, survey.id, "theme", {
      body: theme,
      ifMatch: await etagOf(first),
    });
    expect(saved.status).toBe(204);
    expect(await (await getDocument(headers, survey.id, "theme")).json()).toEqual(theme);
  });
});

describe("the survey history", () => {
  it("grows by one entry per definition save, and not on a theme save", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers);
    const start = (await history(headers, survey.id)).length;

    let tag = await etagOf(await getDocument(headers, survey.id, "definition"));
    for (const title of ["One", "Two"]) {
      await tick();
      const saved = await putDocument(headers, survey.id, "definition", {
        body: { title },
        ifMatch: tag,
      });
      expect(saved.status).toBe(204);
      tag = await etagOf(saved);
    }
    const afterDefinitions = await history(headers, survey.id);
    expect(afterDefinitions).toHaveLength(start + 2);
    expect(afterDefinitions[0]?.user).toEqual({ id: admin.id, displayName: admin.displayName });

    const themeTag = await etagOf(await getDocument(headers, survey.id, "theme"));
    const theme = await putDocument(headers, survey.id, "theme", {
      body: { themeName: "x" },
      ifMatch: themeTag,
    });
    expect(theme.status).toBe(204);
    expect(await history(headers, survey.id)).toHaveLength(start + 2);
  });

  it("starts with one entry for a survey created with a definition", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers, { definition: { title: "Start" } });
    const entries = await history(headers, survey.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.user).toEqual({ id: admin.id, displayName: admin.displayName });
  });

  it("lists the legacy entries of Customer feedback with no user", async (ctx) => {
    const headers = await as(ctx, owner);
    const entries = await history(headers, fixture.feedback);
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.user)).toEqual([null, null]);
  });

  it("pages through every entry once, newest first", async (ctx) => {
    const headers = await as(ctx, admin);
    const survey = await created(headers, { definition: { title: "Start" } });
    let tag = await etagOf(await getDocument(headers, survey.id, "definition"));
    for (const title of ["One", "Two"]) {
      await tick();
      const saved = await putDocument(headers, survey.id, "definition", {
        body: { title },
        ifMatch: tag,
      });
      tag = await etagOf(saved);
    }
    const all = await history(headers, survey.id);
    expect(all).toHaveLength(3);

    const walked: HistoryEntry[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
      const response = await call("GET", "/surveys/{surveyId}/history", {
        path: `/surveys/${survey.id}/history?limit=1${query}`,
        headers,
      });
      expect(response.status).toBe(200);
      const page = (await response.json()) as HistoryPage;
      expect(page.items).toHaveLength(1);
      walked.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(walked).toEqual(all);
    const times = walked.map((entry) => Date.parse(entry.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("answers 400 for an invalid cursor", async (ctx) => {
    const headers = await as(ctx, owner);
    const response = await call("GET", "/surveys/{surveyId}/history", {
      path: `/surveys/${fixture.feedback}/history?cursor=not-a-cursor`,
      headers,
    });
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("bad-request");
  });

  it("answers 404 for a survey the user cannot see and for an unknown id", async (ctx) => {
    const headers = await as(ctx, outsider);
    for (const id of [fixture.campaign, UNKNOWN_ID]) {
      const response = await call("GET", "/surveys/{surveyId}/history", {
        path: `/surveys/${id}/history`,
        headers,
      });
      expect(response.status).toBe(404);
    }
  });
});
