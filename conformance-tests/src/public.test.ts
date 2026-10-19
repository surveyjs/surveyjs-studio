/**
 * The run page's operations against the legacy fixtures: `getPublishedSurvey`, `submitResponse`
 * and `getResultStats`.
 *
 * The data is shared by all test files and never reset (the Azurite replica keeps its result
 * tables between runs), so every test that submits creates its own survey in the admin's Personal
 * scope (with a definition, published through `PATCH`) and submits only to that one. No fixture
 * survey gets a response or a marker: the checks on fixtures are reads and refusals. Cleanup
 * (archive, then delete) is registered with `onTestFinished` right after a survey is created.
 *
 * The 429 test sends its own random `X-Forwarded-For` (the server trusts the test client's
 * address, see `global-setup.ts`), so no other test shares its counter.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it, onTestFinished, type TestContext } from "vitest";
import { call, codeOf, sessionHeaders, signedIn } from "./harness.js";
import { fixtureUsers, type SignInResult } from "./sign-in.js";

const { owner, admin, outsider } = fixtureUsers;

const UNKNOWN_ID = "99999999-0000-4000-8000-a00000000099";

const fixture = {
  customerFeedback: "22222222-0000-4000-8000-a00000000001",
  unpublished: "22222222-0000-4000-8000-a00000000002",
  archivedPublished: "22222222-0000-4000-8000-a00000000005",
  unpublishedRetro: "22222222-0000-4000-8000-a00000000006",
};

const PUBLISHED = "/public/surveys/{surveyId}";
const RESPONSES = "/public/surveys/{surveyId}/responses";
const STATS = "/surveys/{surveyId}/results/stats";

const NOT_AVAILABLE = { code: "survey-not-available", title: "This survey is not available" };

type Headers = Record<string, string>;

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

/**
 * Creates a survey in the admin's Personal scope with the definition, publishes it unless told
 * not to, and registers its cleanup; returns its id.
 */
async function ownSurvey(
  headers: Headers,
  definition: Record<string, unknown> = {},
  published = true,
): Promise<string> {
  const response = await call("POST", "/surveys", { headers, body: { definition } });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  onTestFinished(() => cleanUp(headers, id));
  if (published) {
    const patched = await call("PATCH", "/surveys/{surveyId}", {
      path: `/surveys/${id}`,
      headers: { "content-type": "application/merge-patch+json", ...headers },
      body: { published: true },
    });
    expect(patched.status).toBe(200);
  }
  return id;
}

/** A definition with one text question. */
const ONE_QUESTION = {
  pages: [{ name: "page1", elements: [{ type: "text", name: "q1" }] }],
};

function load(surveyId: string, clientId?: string): Promise<Response> {
  const query = clientId === undefined ? "" : `?clientId=${encodeURIComponent(clientId)}`;
  return call("GET", PUBLISHED, { path: `/public/surveys/${surveyId}${query}` });
}

function submit(
  surveyId: string,
  body: unknown,
  options: { key?: string; headers?: Headers } = {},
): Promise<Response> {
  return call("POST", RESPONSES, {
    path: `/public/surveys/${surveyId}/responses`,
    body,
    headers: {
      ...(options.key !== undefined && { "idempotency-key": options.key }),
      ...options.headers,
    },
  });
}

async function idOf(response: Response): Promise<string> {
  return ((await response.json()) as { id: string }).id;
}

function stats(surveyId: string, headers?: Headers): Promise<Response> {
  return call("GET", STATS, {
    path: `/surveys/${surveyId}/results/stats`,
    ...(headers && { headers }),
  });
}

async function countOf(surveyId: string, headers: Headers): Promise<number> {
  const response = await stats(surveyId, headers);
  expect(response.status).toBe(200);
  return ((await response.json()) as { count: number }).count;
}

async function expectNotAvailable(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject(NOT_AVAILABLE);
}

describe("getPublishedSurvey", () => {
  it("returns a published survey with its theme and, with a client, whether it completed", async (ctx) => {
    const olivia = await as(ctx, owner);
    const definition = await call("GET", "/surveys/{surveyId}/definition", {
      path: `/surveys/${fixture.customerFeedback}/definition`,
      headers: olivia,
    });
    const theme = await call("GET", "/surveys/{surveyId}/theme", {
      path: `/surveys/${fixture.customerFeedback}/theme`,
      headers: olivia,
    });

    const response = await load(fixture.customerFeedback);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toStrictEqual({
      id: fixture.customerFeedback,
      name: "Customer feedback",
      definition: {
        ...((await definition.json()) as Record<string, unknown>),
        cookieName: fixture.customerFeedback,
      },
      theme: await theme.json(),
    });
    expect(body).not.toHaveProperty("completed");

    // The fixture client has a partial marker only; an unknown client has none.
    expect(await (await load(fixture.customerFeedback, "client-0001")).json()).toMatchObject({
      completed: false,
    });
    expect(await (await load(fixture.customerFeedback, "nobody")).json()).toMatchObject({
      completed: false,
    });
  });

  it("serves an archived survey that is published", async () => {
    expect((await load(fixture.archivedPublished)).status).toBe(200);
  });

  it("does not tell an unpublished survey from an unknown one", async () => {
    const responses = [
      await load(fixture.unpublished),
      await load(fixture.unpublishedRetro),
      await load(UNKNOWN_ID),
    ];
    const bodies: unknown[] = [];
    for (const response of responses) {
      expect(response.status).toBe(404);
      bodies.push(await response.json());
    }
    expect(bodies[0]).toMatchObject(NOT_AVAILABLE);
    expect(bodies[1]).toStrictEqual(bodies[0]);
    expect(bodies[2]).toStrictEqual(bodies[0]);
  });

  it("refuses a client id that is too long or holds a reserved character", async () => {
    for (const clientId of ["c".repeat(257), "a/b"]) {
      const response = await load(fixture.customerFeedback, clientId);
      expect(response.status).toBe(400);
    }
  });
});

describe("submitResponse", () => {
  it("stores a response once per Idempotency-Key", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, ONE_QUESTION);
    const key = `k-${randomUUID()}`;

    const first = await submit(surveyId, { data: { q1: "a" } }, { key });
    expect(first.status).toBe(201);
    const id = await idOf(first);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const replay = await submit(surveyId, { data: { q1: "other" } }, { key });
    expect(replay.status).toBe(201);
    expect(await idOf(replay)).toBe(id);
    expect(await countOf(surveyId, headers)).toBe(1);

    const keyless = await submit(surveyId, { data: { q1: "b" } });
    expect(keyless.status).toBe(201);
    expect(await idOf(keyless)).not.toBe(id);
    const counted = await stats(surveyId, headers);
    const body = (await counted.json()) as {
      count: number;
      firstSubmittedAt: string;
      lastSubmittedAt: string;
    };
    expect(body.count).toBe(2);
    expect(Date.parse(body.firstSubmittedAt)).toBeLessThanOrEqual(Date.parse(body.lastSubmittedAt));
  });

  it("limits a client to one response when the definition names a cookie", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, { ...ONE_QUESTION, cookieName: "limit-test" });
    const clientId = `client-${randomUUID()}`;
    const body = { data: { q1: "a" }, clientId };

    expect(await (await load(surveyId)).json()).toMatchObject({
      definition: { cookieName: "limit-test" },
    });
    expect(await (await load(surveyId, clientId)).json()).toMatchObject({ completed: false });

    const first = await submit(surveyId, body, { key: "A" });
    expect(first.status).toBe(201);
    expect(await (await load(surveyId, clientId)).json()).toMatchObject({ completed: true });

    const again = await submit(surveyId, body, { key: "B" });
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("already-completed");

    const replay = await submit(surveyId, body, { key: "A" });
    expect(replay.status).toBe(201);
    expect(await idOf(replay)).toBe(await idOf(first));

    expect((await submit(surveyId, { data: { q1: "a" } })).status).toBe(201);
    expect(
      (await submit(surveyId, { data: { q1: "a" }, clientId: `client-${randomUUID()}` })).status,
    ).toBe(201);
  });

  it("accepts a client again when no cookie name limits the survey", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, ONE_QUESTION);
    const body = { data: { q1: "a" }, clientId: `client-${randomUUID()}` };
    expect((await submit(surveyId, body)).status).toBe(201);
    expect((await submit(surveyId, body)).status).toBe(201);
    expect(await (await load(surveyId, body.clientId)).json()).toMatchObject({ completed: true });
  });

  it("stores a partial response as complete", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, ONE_QUESTION);
    const clientId = `client-${randomUUID()}`;
    const response = await submit(surveyId, { data: { q1: "a" }, clientId, partial: true });
    expect(response.status).toBe(201);
    expect(await (await load(surveyId, clientId)).json()).toMatchObject({ completed: true });
  });

  it("refuses what it cannot store", async (ctx) => {
    const headers = await as(ctx, admin);
    const unpublished = await ownSurvey(headers, ONE_QUESTION, false);
    await expectNotAvailable(await submit(unpublished, { data: { q1: "a" } }));
    await expectNotAvailable(await submit(fixture.unpublished, { data: { q1: "a" } }));
    await expectNotAvailable(await submit(UNKNOWN_ID, { data: { q1: "a" } }));
    expect(await countOf(unpublished, headers)).toBe(0);

    const surveyId = await ownSurvey(headers, ONE_QUESTION);
    expect((await submit(surveyId, {})).status).toBe(422);
    expect((await submit(surveyId, { data: 1 })).status).toBe(422);
    const text = await call("POST", RESPONSES, {
      path: `/public/surveys/${surveyId}/responses`,
      rawBody: "data=1",
      headers: { "content-type": "text/plain" },
    });
    expect(text.status).toBe(415);
    const malformed = await call("POST", RESPONSES, {
      path: `/public/surveys/${surveyId}/responses`,
      rawBody: "{",
    });
    expect(malformed.status).toBe(400);
    expect((await submit(surveyId, { data: {} }, { key: "" })).status).toBe(400);
    expect((await submit(surveyId, { data: {} }, { key: "k".repeat(129) })).status).toBe(400);
    expect(await countOf(surveyId, headers)).toBe(0);
  });

  it("refuses a body over limits.maxResponseBytes", async (ctx) => {
    const config = await call("GET", "/config");
    const limit = ((await config.json()) as { limits: { maxResponseBytes: number } }).limits
      .maxResponseBytes;
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, ONE_QUESTION);
    const frame = JSON.stringify({ data: { t: "" } });
    const rawBody = JSON.stringify({ data: { t: "x".repeat(limit + 1 - frame.length) } });
    expect(Buffer.byteLength(rawBody)).toBe(limit + 1);
    const response = await call("POST", RESPONSES, {
      path: `/public/surveys/${surveyId}/responses`,
      rawBody,
    });
    expect(response.status).toBe(413);
    expect(await codeOf(response)).toBe("payload-too-large");
    expect(await countOf(surveyId, headers)).toBe(0);
  });
});

describe("public rate limit", () => {
  it("answers 429 with Retry-After once an address has made too many requests", async () => {
    const address = `198.51.100.${1 + Math.floor(Math.random() * 254)}`;
    const tooLongId = "x".repeat(65);
    let limited: Response | undefined;
    for (let i = 0; i < 1000 && !limited; i += 1) {
      const response = await call("GET", PUBLISHED, {
        path: `/public/surveys/${tooLongId}`,
        headers: { "x-forwarded-for": address },
      });
      if (response.status === 429) limited = response;
      else expect(response.status).toBe(400);
    }
    expect(limited).toBeDefined();
    expect(Number(limited?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await codeOf(limited!)).toBe("rate-limited");
  });
});

describe("getResultStats", () => {
  it("counts the responses the fixture survey holds, for a user who can see it", async (ctx) => {
    const response = await stats(fixture.customerFeedback, await as(ctx, owner));
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({
      count: 5,
      firstSubmittedAt: "2026-04-01T08:00:00.500Z",
      lastSubmittedAt: "2026-04-01T12:00:00.000Z",
    });
  });

  it("reports nothing for a survey without responses", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers);
    expect(await (await stats(surveyId, headers)).json()).toStrictEqual({
      count: 0,
      firstSubmittedAt: null,
      lastSubmittedAt: null,
    });
  });

  it("answers 404 for a survey the user cannot see and for an unknown one, 401 without a session", async (ctx) => {
    expect((await stats(fixture.customerFeedback, await as(ctx, outsider))).status).toBe(404);
    expect((await stats(UNKNOWN_ID, await as(ctx, owner))).status).toBe(404);
    expect((await stats(fixture.customerFeedback)).status).toBe(401);
  });
});
