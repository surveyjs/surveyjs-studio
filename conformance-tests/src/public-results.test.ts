/**
 * `getPublicResults` against the legacy fixtures: the Grant Access rule, paging, the private-question
 * strip and the refusals.
 *
 * The data is shared by all test files and never reset (the Azurite replica keeps its tables between
 * runs), so every test that writes creates its own survey in the admin's Personal scope and writes only
 * to that one. The fixture survey `…a01` (Grant Access on, private question `receipt`) is read only.
 * Cleanup (archive, then delete) is registered with `onTestFinished` right after a survey is created.
 */
import { describe, expect, it, onTestFinished, type TestContext } from "vitest";
import { call, codeOf, sessionHeaders, signedIn } from "./harness.js";
import { fixtureUsers, type SignInResult } from "./sign-in.js";

const { admin } = fixtureUsers;

const UNKNOWN_ID = "99999999-0000-4000-8000-a00000000099";
const FEEDBACK = "22222222-0000-4000-8000-a00000000001";

const PUBLIC_RESULTS = "/public/surveys/{surveyId}/results";
const RESPONSES = "/public/surveys/{surveyId}/responses";
const MERGE_PATCH = "application/merge-patch+json";

const NOT_AVAILABLE = { code: "survey-not-available", title: "This survey is not available" };

type Headers = Record<string, string>;

interface PublicItem {
  submittedAt: string;
  data: Record<string, unknown>;
}
interface PublicPage {
  survey: { id: string; name: string; definition: unknown; privateQuestions?: string[] };
  items: PublicItem[];
  nextCursor: string | null;
}

const sessions = new Map<string, SignInResult>();

async function as(ctx: TestContext, user: { id: string }): Promise<Headers> {
  let session = sessions.get(user.id);
  if (!session) {
    session = await signedIn(ctx, user.id);
    expect(session.callback.status).toBe(302);
    sessions.set(user.id, session);
  }
  return sessionHeaders(session);
}

const merge = (headers: Headers): Headers => ({ "content-type": MERGE_PATCH, ...headers });

function patch(headers: Headers, id: string, body: unknown): Promise<Response> {
  return call("PATCH", "/surveys/{surveyId}", {
    path: `/surveys/${id}`,
    headers: merge(headers),
    body,
  });
}

async function cleanUp(headers: Headers, id: string): Promise<void> {
  const archived = await patch(headers, id, { archived: true });
  if (archived.status === 404) return;
  expect(archived.status).toBe(200);
  const deleted = await call("DELETE", "/surveys/{surveyId}", { path: `/surveys/${id}`, headers });
  expect([204, 404]).toContain(deleted.status);
}

/** A published survey of the admin with the definition; its cleanup is registered. */
async function ownSurvey(headers: Headers, definition: unknown): Promise<string> {
  const response = await call("POST", "/surveys", { headers, body: { definition } });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  onTestFinished(() => cleanUp(headers, id));
  expect((await patch(headers, id, { published: true })).status).toBe(200);
  return id;
}

const TEXT_SURVEY = { pages: [{ name: "page1", elements: [{ type: "text", name: "q1" }] }] };

const pause = () => new Promise((resolve) => setTimeout(resolve, 15));

async function submitted(surveyId: string, data: Record<string, unknown>): Promise<void> {
  const response = await call("POST", RESPONSES, {
    path: `/public/surveys/${surveyId}/responses`,
    body: { data },
  });
  expect(response.status).toBe(201);
  await pause();
}

function results(surveyId: string, query = ""): Promise<Response> {
  return call("GET", PUBLIC_RESULTS, { path: `/public/surveys/${surveyId}/results${query}` });
}

async function expectNotAvailable(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject(NOT_AVAILABLE);
}

describe("getPublicResults", () => {
  it("serves Customer feedback without the private question, to anyone", async () => {
    const response = await results(FEEDBACK);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toStrictEqual({
      survey: {
        id: FEEDBACK,
        name: "Customer feedback",
        definition: {
          title: "Customer feedback",
          pages: [
            {
              name: "page1",
              elements: [
                { type: "rating", name: "satisfaction", title: "How satisfied are you?" },
                { type: "file", name: "receipt", title: "Upload your receipt" },
              ],
            },
          ],
        },
        privateQuestions: ["receipt"],
      },
      items: [4, 2, 5, 3, 1].map((satisfaction) => ({
        submittedAt: expect.any(String) as string,
        data: { satisfaction },
      })),
      nextCursor: null,
    });
  });

  it("follows Grant Access, not publication or archiving, and pages like listResults", async (ctx) => {
    const adam = await as(ctx, admin);
    const id = await ownSurvey(adam, TEXT_SURVEY);
    for (const q1 of ["a", "b", "c"]) await submitted(id, { q1 });

    await expectNotAvailable(await results(id));

    expect((await patch(adam, id, { settings: { publicResults: true } })).status).toBe(200);
    const all = await results(id);
    expect(all.status).toBe(200);
    const page = (await all.json()) as PublicPage;
    expect(page.items.map((item) => item.data)).toEqual([{ q1: "a" }, { q1: "b" }, { q1: "c" }]);
    for (const item of page.items)
      expect(Object.keys(item).sort()).toEqual(["data", "submittedAt"]);
    expect(page.nextCursor).toBeNull();

    const first = (await (await results(id, "?limit=2")).json()) as PublicPage;
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await (
      await results(id, `?limit=2&cursor=${first.nextCursor ?? ""}`)
    ).json()) as PublicPage;
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    expect((await patch(adam, id, { published: false })).status).toBe(200);
    expect((await results(id)).status).toBe(200);
    expect((await patch(adam, id, { archived: true })).status).toBe(200);
    expect((await results(id)).status).toBe(200);

    expect((await patch(adam, id, { settings: { publicResults: false } })).status).toBe(200);
    await expectNotAvailable(await results(id));
  });

  it("leaves out the answers and comments of private questions", async (ctx) => {
    const adam = await as(ctx, admin);
    const id = await ownSurvey(adam, {
      pages: [
        {
          name: "page1",
          elements: [
            { type: "text", name: "q1" },
            { type: "radiogroup", name: "q2", choices: ["x"], showOtherItem: true },
          ],
        },
      ],
    });
    await submitted(id, { q1: "a", q2: "other", "q2-Comment": "secret" });
    const patched = await patch(adam, id, {
      settings: { publicResults: true, privateResultQuestions: ["q2"] },
    });
    expect(patched.status).toBe(200);
    const page = (await (await results(id)).json()) as PublicPage;
    expect(page.items.map((item) => item.data)).toEqual([{ q1: "a" }]);
    expect(page.survey.privateQuestions).toEqual(["q2"]);
  });

  it("refuses unknown surveys, bad paging and cursors of another survey", async (ctx) => {
    await expectNotAvailable(await results(UNKNOWN_ID));
    for (const query of ["?limit=0", "?limit=1001"]) {
      const response = await results(FEEDBACK, query);
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe("bad-request");
    }
    const invalid = await results(FEEDBACK, "?cursor=x");
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ detail: "Invalid cursor." });

    const adam = await as(ctx, admin);
    const patchBoth = async (): Promise<string> => {
      const id = await ownSurvey(adam, TEXT_SURVEY);
      await submitted(id, { q1: "a" });
      await submitted(id, { q1: "b" });
      expect((await patch(adam, id, { settings: { publicResults: true } })).status).toBe(200);
      return id;
    };
    const one = await patchBoth();
    const other = await patchBoth();
    const page = (await (await results(one, "?limit=1")).json()) as PublicPage;
    expect(page.nextCursor).not.toBeNull();
    const crossed = await results(other, `?cursor=${page.nextCursor ?? ""}`);
    expect(crossed.status).toBe(400);
    expect(await crossed.json()).toMatchObject({ detail: "Invalid cursor." });

    const tooLong = await results("x".repeat(65));
    expect(tooLong.status).toBe(400);
  });
});

describe("getPublicResults rate limit", () => {
  it("answers 429 with Retry-After once an address has made too many requests", async () => {
    const address = `198.51.100.${1 + Math.floor(Math.random() * 254)}`;
    const tooLongId = "x".repeat(65);
    let limited: Response | undefined;
    for (let i = 0; i < 1000 && !limited; i += 1) {
      const response = await call("GET", PUBLIC_RESULTS, {
        path: `/public/surveys/${tooLongId}/results`,
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
