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
import { describe, expect, it } from "vitest";
import {
  call,
  codeOf,
  as,
  expectNotRouted,
  hosted,
  newSurvey,
  ownSurvey,
  ownsServer,
  sandbox,
  setPublished,
} from "./harness.js";
import { fixtureUsers } from "./sign-in.js";

const { owner, admin, outsider } = fixtureUsers;

const UNKNOWN_ID = "99999999-0000-4000-8000-a00000000099";

const fixture = {
  customerFeedback: "22222222-0000-4000-8000-a00000000001",
  /** "Draft idea": an empty (NULL) published flag, which means published. */
  emptyFlag: "22222222-0000-4000-8000-a00000000002",
  /** "Old poll": unpublished (0) and archived. */
  unpublishedArchived: "22222222-0000-4000-8000-a00000000003",
  archivedPublished: "22222222-0000-4000-8000-a00000000005",
  unpublishedRetro: "22222222-0000-4000-8000-a00000000006",
};

const PUBLISHED = "/public/surveys/{surveyId}";
const RESPONSES = "/public/surveys/{surveyId}/responses";
const STATS = "/surveys/{surveyId}/results/stats";

const NOT_AVAILABLE = { code: "survey-not-available", title: "This survey is not available" };

type Headers = Record<string, string>;

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

async function results(surveyId: string, headers: Headers): Promise<Record<string, unknown>[]> {
  const response = await call("GET", "/surveys/{surveyId}/results", {
    path: `/surveys/${surveyId}/results?limit=500`,
    headers,
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: Record<string, unknown>[] }).items;
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

  it("serves a survey whose published flag is empty, as the old run page did", async () => {
    const response = await load(fixture.emptyFlag);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: fixture.emptyFlag, name: "Draft idea" });
  });

  it("does not tell an unpublished survey from an unknown one", async () => {
    const responses = [
      await load(fixture.unpublishedArchived),
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

describe("a new survey", () => {
  it("runs at once, stops when unpublished and runs again when published", async (ctx) => {
    const headers = await as(ctx, admin);
    // No PATCH: the new survey's published flag is empty, which means published.
    const surveyId = await newSurvey(headers, { definition: ONE_QUESTION });
    const read = await call("GET", "/surveys/{surveyId}", {
      path: `/surveys/${surveyId}`,
      headers,
    });
    expect(await read.json()).toMatchObject({ published: true });
    expect((await load(surveyId)).status).toBe(200);
    expect((await submit(surveyId, { data: { q1: "a" } })).status).toBe(201);
    expect(await countOf(surveyId, headers)).toBe(1);

    await setPublished(headers, surveyId, false);
    await expectNotAvailable(await load(surveyId));
    await expectNotAvailable(await submit(surveyId, { data: { q1: "b" } }));

    await setPublished(headers, surveyId, true);
    expect((await load(surveyId)).status).toBe(200);
    expect((await submit(surveyId, { data: { q1: "c" } })).status).toBe(201);
    expect(await countOf(surveyId, headers)).toBe(2);
  });
});

describe("submitResponse", () => {
  it("stores a response once per Idempotency-Key", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, { definition: ONE_QUESTION });
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
    const surveyId = await ownSurvey(headers, {
      definition: { ...ONE_QUESTION, cookieName: "limit-test" },
    });
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
    const surveyId = await ownSurvey(headers, { definition: ONE_QUESTION });
    const body = { data: { q1: "a" }, clientId: `client-${randomUUID()}` };
    expect((await submit(surveyId, body)).status).toBe(201);
    expect((await submit(surveyId, body)).status).toBe(201);
    expect(await (await load(surveyId, body.clientId)).json()).toMatchObject({ completed: true });
  });

  it("stores a partial response without a client id as complete", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, { definition: ONE_QUESTION });
    const response = await submit(surveyId, { data: { q1: "a" }, partial: true });
    expect(response.status).toBe(201);
    expect(await countOf(surveyId, headers)).toBe(1);
    const listed = await results(surveyId, headers);
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("partial");
  });

  it("saves progress for a client and completes it with a later post", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, { definition: ONE_QUESTION });
    const clientId = `client-${randomUUID()}`;

    const first = await submit(surveyId, {
      data: { q1: "a" },
      clientId,
      partial: true,
      lastPageIndex: 0,
    });
    expect(first.status).toBe(201);
    const partialId = await idOf(first);
    expect(await (await load(surveyId, clientId)).json()).toMatchObject({ completed: false });
    expect(await countOf(surveyId, headers)).toBe(0);
    expect(await results(surveyId, headers)).toMatchObject([
      { id: partialId, clientId, data: { q1: "a" }, partial: true },
    ]);
    const exportedJson = await call("GET", "/surveys/{surveyId}/results/export", {
      path: `/surveys/${surveyId}/results/export?format=json`,
      headers,
    });
    if (!sandbox) {
      expect(await exportedJson.json()).toMatchObject([{ id: partialId, partial: true }]);
      const csv = await call("GET", "/surveys/{surveyId}/results/export", {
        path: `/surveys/${surveyId}/results/export?format=csv`,
        headers,
      });
      const lines = (await csv.text()).split("\r\n");
      expect(lines[0]).toBe("Submitted,q1,ClientId,Partial");
      expect(lines[1]).toMatch(/,a,.*,true$/);
    }
    const grant = await call("PATCH", "/surveys/{surveyId}", {
      path: `/surveys/${surveyId}`,
      headers: { "content-type": "application/merge-patch+json", ...headers },
      body: { settings: { publicResults: true } },
    });
    expect(grant.status).toBe(200);
    const publicItems = async () => {
      const open = await call("GET", "/public/surveys/{surveyId}/results", {
        path: `/public/surveys/${surveyId}/results`,
      });
      expect(open.status).toBe(200);
      return ((await open.json()) as { items: unknown[] }).items;
    };
    expect(await publicItems()).toHaveLength(0);

    const done = await submit(surveyId, { data: { q1: "b" }, clientId });
    expect(done.status).toBe(201);
    expect(await (await load(surveyId, clientId)).json()).toMatchObject({ completed: true });
    expect(await countOf(surveyId, headers)).toBe(1);
    const listed = await results(surveyId, headers);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: partialId, data: { q1: "b" } });
    expect(listed[0]).not.toHaveProperty("partial");
    expect(await publicItems()).toMatchObject([{ data: { q1: "b" } }]);
    if (!sandbox) {
      const csv = await call("GET", "/surveys/{surveyId}/results/export", {
        path: `/surveys/${surveyId}/results/export?format=csv`,
        headers,
      });
      expect((await csv.text()).split("\r\n")[0]).toBe("Submitted,q1,ClientId");
    }
  });

  it("refuses a negative lastPageIndex", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, { definition: ONE_QUESTION });
    const response = await submit(surveyId, { data: {}, clientId: "c", lastPageIndex: -1 });
    expect(response.status).toBe(422);
    expect(await countOf(surveyId, headers)).toBe(0);
  });

  it("limits to one response only once the client has completed", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, {
      definition: { ...ONE_QUESTION, cookieName: "limit-partial" },
    });
    const clientId = `client-${randomUUID()}`;
    const post = (extra: object) => submit(surveyId, { data: { q1: "a" }, clientId, ...extra });
    expect((await post({ partial: true })).status).toBe(201);
    expect((await post({ partial: true })).status).toBe(201);
    expect((await post({})).status).toBe(201);
    const refusedPartial = await post({ partial: true });
    expect(refusedPartial.status).toBe(409);
    expect(await codeOf(refusedPartial)).toBe("already-completed");
    expect((await post({})).status).toBe(409);
  });

  it("stores a partial post once per Idempotency-Key", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, { definition: ONE_QUESTION });
    const body = { data: { q1: "a" }, clientId: `client-${randomUUID()}`, partial: true };
    const key = randomUUID();
    const first = await submit(surveyId, body, { key });
    const replay = await submit(surveyId, body, { key });
    expect(replay.status).toBe(201);
    expect(await idOf(replay)).toBe(await idOf(first));
    expect(await results(surveyId, headers)).toHaveLength(1);
  });

  it("refuses what it cannot store", async (ctx) => {
    const headers = await as(ctx, admin);
    const unpublished = await ownSurvey(headers, { definition: ONE_QUESTION, published: false });
    await expectNotAvailable(await submit(unpublished, { data: { q1: "a" } }));
    await expectNotAvailable(await submit(fixture.unpublishedArchived, { data: { q1: "a" } }));
    await expectNotAvailable(await submit(UNKNOWN_ID, { data: { q1: "a" } }));
    expect(await countOf(unpublished, headers)).toBe(0);

    const surveyId = await ownSurvey(headers, { definition: ONE_QUESTION });
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
    const surveyId = await ownSurvey(headers, { definition: ONE_QUESTION });
    const frame = JSON.stringify({ data: { t: "" } });
    const rawBody = JSON.stringify({ data: { t: "x".repeat(limit + 1 - frame.length) } });
    expect(Buffer.byteLength(rawBody)).toBe(limit + 1);
    const response = await call("POST", RESPONSES, {
      path: `/public/surveys/${surveyId}/responses`,
      rawBody,
    });
    expect(response.status).toBe(413);
    expect(await codeOf(response)).toBe("payload-too-large");
    // The server reads a small overflow to its end and keeps the connection; with Connection: close
    // it would cut the connection while the client is still sending, and the client could see
    // EPIPE instead of this answer.
    // Only the reference server is checked: a proxy in front decides this hop-by-hop header.
    if (ownsServer) expect(response.headers.get("connection")).not.toBe("close");
    expect(await countOf(surveyId, headers)).toBe(0);
  });
});

describe("public rate limit", () => {
  it("answers 429 with Retry-After once an address has made too many requests", async (ctx) => {
    if (sandbox) ctx.skip("rate limits are server-only");
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
      count: 4,
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

/** The survey's post and result IDs, read as its owner. */
async function keysOf(
  headers: Headers,
  surveyId: string,
): Promise<{ postId: string; resultId: string }> {
  const read = await call("GET", "/surveys/{surveyId}", { path: `/surveys/${surveyId}`, headers });
  return (await read.json()) as { postId: string; resultId: string };
}

function definitionOf(surveyId: string, headers: Headers = {}): Promise<Response> {
  return call("GET", "/public/surveys/{surveyId}/definition", {
    path: `/public/surveys/${surveyId}/definition`,
    headers,
  });
}

async function stateOf(surveyId: string, clientId: string): Promise<unknown> {
  const response = await call("GET", "/public/surveys/{surveyId}/respondents/{clientId}", {
    path: `/public/surveys/${surveyId}/respondents/${encodeURIComponent(clientId)}`,
  });
  expect(response.status).toBe(200);
  return response.json();
}

function stateByResultId(resultId: string, clientId: string): Promise<Response> {
  return call("GET", "/public/results/{resultId}/respondents/{clientId}", {
    path: `/public/results/${resultId}/respondents/${encodeURIComponent(clientId)}`,
  });
}

function submitByPostId(
  postId: string,
  body: unknown,
  options: { key?: string } = {},
): Promise<Response> {
  return call("POST", "/public/posts/{postId}/responses", {
    path: `/public/posts/${postId}/responses`,
    body,
    headers: options.key === undefined ? {} : { "idempotency-key": options.key },
  });
}

// The operations for surveys built for the old service (ADR 0039) exist in the hosted edition only.
describe.skipIf(hosted)("the bridge's operations outside the hosted edition", () => {
  it("names the edition the suite was given in /config", async () => {
    const config = await call("GET", "/config");
    expect(((await config.json()) as { edition: string }).edition).toBe("self-hosted");
  });

  it("answers 404 not-found as for an unknown path, for a survey that exists", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, { definition: ONE_QUESTION, published: false });
    const { postId, resultId } = await keysOf(headers, surveyId);
    await expectNotRouted(await definitionOf(surveyId));
    await expectNotRouted(
      await call("GET", "/public/surveys/{surveyId}/respondents/{clientId}", {
        path: `/public/surveys/${surveyId}/respondents/c`,
      }),
    );
    await expectNotRouted(await stateByResultId(resultId, "c"));
    await expectNotRouted(await summaryOf(resultId, "q1"));
    await expectNotRouted(await submitByPostId(postId, { data: { q1: "a" } }));
    expect(await countOf(surveyId, headers)).toBe(0);
  });
});

describe.runIf(hosted)("the hosted edition", () => {
  it("names the edition the suite was given in /config", async () => {
    const config = await call("GET", "/config");
    expect(((await config.json()) as { edition: string }).edition).toBe("hosted");
  });
});

describe.runIf(hosted)("getPublicDefinition", () => {
  it("serves the working definition of any survey, with a strong ETag to revalidate", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, { definition: ONE_QUESTION, published: false });
    await expectNotAvailable(await load(surveyId));

    const first = await definitionOf(surveyId);
    expect(first.status).toBe(200);
    expect(await first.json()).toStrictEqual(ONE_QUESTION);
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"[^"]+"$/);
    expect(first.headers.get("cache-control")).toBe("no-cache");

    for (const match of [etag!, `"other", ${etag!}`, "*"]) {
      const same = await definitionOf(surveyId, { "if-none-match": match });
      expect(same.status).toBe(304);
      expect(same.headers.get("etag")).toBe(etag);
      expect(same.headers.get("cache-control")).toBe("no-cache");
      expect(await same.text()).toBe("");
    }
    const stale = await definitionOf(surveyId, { "if-none-match": '"stale"' });
    expect(stale.status).toBe(200);

    const edited = { pages: [{ name: "page1", elements: [{ type: "text", name: "q2" }] }] };
    const saved = await call("PUT", "/surveys/{surveyId}/definition", {
      path: `/surveys/${surveyId}/definition`,
      headers: { ...headers, "if-match": etag! },
      body: edited,
    });
    expect(saved.status).toBe(204);
    const changed = await definitionOf(surveyId, { "if-none-match": etag! });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
    expect(await changed.json()).toStrictEqual(edited);
  });

  it("serves an archived survey and answers 404 for an unknown one", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await newSurvey(headers, { definition: ONE_QUESTION });
    const archived = await call("PATCH", "/surveys/{surveyId}", {
      path: `/surveys/${surveyId}`,
      headers: { "content-type": "application/merge-patch+json", ...headers },
      body: { archived: true },
    });
    expect(archived.status).toBe(200);
    expect((await definitionOf(surveyId)).status).toBe(200);
    expect((await definitionOf(fixture.unpublishedArchived)).status).toBe(200);
    await expectNotAvailable(await definitionOf(UNKNOWN_ID));
  });
});

describe.runIf(hosted)("getRespondentState", () => {
  it("follows the client's marker, by survey ID and by result ID", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, { definition: ONE_QUESTION, published: false });
    const { postId, resultId } = await keysOf(headers, surveyId);
    const clientId = `client ${randomUUID()}%`;
    const both = async (state: string) => {
      expect(await stateOf(surveyId, clientId)).toStrictEqual({ state });
      const byResult = await stateByResultId(resultId, clientId);
      expect(byResult.status).toBe(200);
      expect(await byResult.json()).toStrictEqual({ state });
    };
    const post = (extra: object) =>
      submitByPostId(postId, { data: { q1: "a" }, clientId, ...extra });

    await both("none");
    expect((await post({ partial: true })).status).toBe(201);
    await both("partial");
    expect((await post({})).status).toBe(201);
    await both("completed");
    expect((await post({ partial: true })).status).toBe(201);
    await both("partial");
  });

  it("routes a client ID of the longest length, 256 characters, on both paths", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, { definition: ONE_QUESTION });
    const { resultId } = await keysOf(headers, surveyId);
    const clientId = "c".repeat(256);
    expect(await stateOf(surveyId, clientId)).toStrictEqual({ state: "none" });
    const byResult = await stateByResultId(resultId, clientId);
    expect(byResult.status).toBe(200);
    expect(await byResult.json()).toStrictEqual({ state: "none" });
  });

  it("answers 404 for an unknown survey or result ID", async () => {
    const response = await call("GET", "/public/surveys/{surveyId}/respondents/{clientId}", {
      path: `/public/surveys/${UNKNOWN_ID}/respondents/c`,
    });
    await expectNotAvailable(response);
    await expectNotAvailable(await stateByResultId(UNKNOWN_ID, "c"));
  });
});

function summaryOf(resultId: string, name: string): Promise<Response> {
  return call("GET", "/public/results/{resultId}/questions/{name}", {
    path: `/public/results/${resultId}/questions/${encodeURIComponent(name)}`,
  });
}

describe.runIf(hosted)("getQuestionSummary", () => {
  it("counts the completed responses only, by result ID", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, { definition: ONE_QUESTION, published: false });
    const { postId, resultId } = await keysOf(headers, surveyId);
    const post = async (data: object, extra: object = {}) => {
      expect((await submitByPostId(postId, { data, ...extra })).status).toBe(201);
    };
    await post({ q1: ["a", "b"] });
    await post({ q1: ["b"] });
    await post({ q1: { r1: "c1" } });
    await post({ q1: 1 });
    await post({ q1: "1" });
    await post({ other: "x" });
    await post({ q1: "partial only" }, { clientId: "p1", partial: true });
    await post({ q1: "run" }, { clientId: "c1", partial: true });
    await post({ q1: ["a"] }, { clientId: "c1" });

    const response = await summaryOf(resultId, "q1");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      answered: 6,
      values: [
        { value: "a", count: 2 },
        { value: "b", count: 2 },
        { value: ["r1", "c1"], count: 1 },
        { value: 1, count: 1 },
        { value: "1", count: 1 },
      ],
      responseCount: 7,
    });
    expect(body.firstSubmittedAt).toEqual(expect.any(String));
    expect(body.lastSubmittedAt).toEqual(expect.any(String));
  });

  it("answers an empty summary for a survey without responses", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, { definition: ONE_QUESTION });
    const { resultId } = await keysOf(headers, surveyId);
    const response = await summaryOf(resultId, "q1");
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({
      answered: 0,
      values: [],
      responseCount: 0,
      firstSubmittedAt: null,
      lastSubmittedAt: null,
    });
  });

  it("routes a question name of the longest length, 256 characters, and refuses a longer one", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, { definition: ONE_QUESTION });
    const { resultId } = await keysOf(headers, surveyId);
    const response = await summaryOf(resultId, `question ${"q".repeat(247)}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({
      answered: 0,
      values: [],
      responseCount: 0,
      firstSubmittedAt: null,
      lastSubmittedAt: null,
    });
    // The contract's `maxLength: 256`: a 300-character name is routed and refused by the schema.
    const longer = await summaryOf(resultId, `question ${"q".repeat(291)}`);
    expect(longer.status).toBe(400);
    expect(await codeOf(longer)).toBe("bad-request");
  });

  it("answers 404 for an unknown result ID", async () => {
    await expectNotAvailable(await summaryOf(UNKNOWN_ID, "q1"));
  });
});

describe.runIf(hosted)("submitResponseByPostId", () => {
  it("stores a response for an unpublished survey, once per Idempotency-Key", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, { definition: ONE_QUESTION, published: false });
    const { postId } = await keysOf(headers, surveyId);
    await expectNotAvailable(await submit(surveyId, { data: { q1: "a" } }));

    const key = `k-${randomUUID()}`;
    const first = await submitByPostId(postId, { data: { q1: "a" } }, { key });
    expect(first.status).toBe(201);
    const replay = await submitByPostId(postId, { data: { q1: "b" } }, { key });
    expect(replay.status).toBe(201);
    expect(await idOf(replay)).toBe(await idOf(first));
    expect(await countOf(surveyId, headers)).toBe(1);
  });

  it("stores a completed client's next post and the marker follows it", async (ctx) => {
    const headers = await as(ctx, admin);
    const surveyId = await ownSurvey(headers, {
      definition: { ...ONE_QUESTION, cookieName: "limit-by-post" },
    });
    const { postId } = await keysOf(headers, surveyId);
    const clientId = `client-${randomUUID()}`;
    const body = { data: { q1: "a" }, clientId };
    expect((await submitByPostId(postId, body)).status).toBe(201);
    expect((await submit(surveyId, body)).status).toBe(409);
    expect((await submitByPostId(postId, body)).status).toBe(201);
    expect(await stateOf(surveyId, clientId)).toStrictEqual({ state: "completed" });
    expect((await submitByPostId(postId, { ...body, partial: true })).status).toBe(201);
    expect(await stateOf(surveyId, clientId)).toStrictEqual({ state: "partial" });
  });

  it("answers 404 for an unknown post ID", async () => {
    await expectNotAvailable(await submitByPostId(UNKNOWN_ID, { data: { q1: "a" } }));
  });
});
