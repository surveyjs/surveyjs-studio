/**
 * `getPublicResults` and (hosted only) `getPublicLayout` against the legacy fixtures: the Grant
 * Access rule, paging, the private-question strip and the refusals.
 *
 * The data is shared by all test files and never reset (the Azurite replica keeps its tables between
 * runs), so every test that writes creates its own survey in the admin's Personal scope and writes only
 * to that one. The fixture survey `…a01` (Grant Access on, private question `receipt`) is read only.
 * Cleanup (archive, then delete) is registered with `onTestFinished` right after a survey is created.
 */
import { describe, expect, it } from "vitest";
import {
  call,
  codeOf,
  as,
  expectNotRouted,
  hosted,
  ownSurvey,
  sandbox,
  submitted,
} from "./harness.js";
import { fixtureUsers } from "./sign-in.js";

const { admin } = fixtureUsers;

const UNKNOWN_ID = "99999999-0000-4000-8000-a00000000099";
const FEEDBACK = "22222222-0000-4000-8000-a00000000001";

const PUBLIC_RESULTS = "/public/surveys/{surveyId}/results";
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

const merge = (headers: Headers): Headers => ({ "content-type": MERGE_PATCH, ...headers });

function patch(headers: Headers, id: string, body: unknown): Promise<Response> {
  return call("PATCH", "/surveys/{surveyId}", {
    path: `/surveys/${id}`,
    headers: merge(headers),
    body,
  });
}

const TEXT_SURVEY = { pages: [{ name: "page1", elements: [{ type: "text", name: "q1" }] }] };

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
      items: [4, 5, 3, 1].map((satisfaction) => ({
        submittedAt: expect.any(String) as string,
        data: { satisfaction },
      })),
      nextCursor: null,
    });
  });

  it("follows Grant Access, not publication or archiving, and pages like listResults", async (ctx) => {
    const adam = await as(ctx, admin);
    const id = await ownSurvey(adam, { definition: TEXT_SURVEY });
    for (const q1 of ["a", "b", "c"]) await submitted(id, { data: { q1 } });

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
      definition: {
        pages: [
          {
            name: "page1",
            elements: [
              { type: "text", name: "q1" },
              { type: "radiogroup", name: "q2", choices: ["x"], showOtherItem: true },
            ],
          },
        ],
      },
    });
    await submitted(id, { data: { q1: "a", q2: "other", "q2-Comment": "secret" } });
    const patched = await patch(adam, id, {
      settings: { publicResults: true, privateResultQuestions: ["q2"] },
    });
    expect(patched.status).toBe(200);
    const page = (await (await results(id)).json()) as PublicPage;
    expect(page.items.map((item) => item.data)).toEqual([{ q1: "a" }]);
    expect(page.survey.privateQuestions).toEqual(["q2"]);
  });

  it("keeps responses strictly between from and till, paging inside them", async () => {
    // Customer feedback's completed responses: 08:00:00.500 (4), 10:30 (5), 11:45 (3), 12:00 (1);
    // the partial one at 09:15 is never listed.
    const satisfaction = async (query: string): Promise<unknown[]> => {
      const response = await results(FEEDBACK, query);
      expect(response.status).toBe(200);
      const page = (await response.json()) as PublicPage;
      return page.items.map((item) => item.data.satisfaction);
    };
    expect(await satisfaction("?from=2026-04-01T10:00:00Z")).toEqual([5, 3, 1]);
    expect(await satisfaction("?till=2026-04-01T11:00:00Z")).toEqual([4, 5]);
    expect(
      await satisfaction("?from=2026-04-01T08:00:00.500Z&till=2026-04-01T12:00:00.000Z"),
    ).toEqual([5, 3]);
    // 10:30Z written with an offset: compared as an instant, and exactly at the bound.
    expect(await satisfaction(`?from=${encodeURIComponent("2026-04-01T12:30:00+02:00")}`)).toEqual([
      3, 1,
    ]);

    const window = "from=2026-04-01T08:00:00.500Z&till=2026-04-01T12:00:00Z";
    const seen: unknown[] = [];
    const cursors: (string | null)[] = [];
    let cursor: string | null = null;
    do {
      const query: string = `?limit=1&${window}${cursor === null ? "" : `&cursor=${cursor}`}`;
      const page = (await (await results(FEEDBACK, query)).json()) as PublicPage;
      seen.push(...page.items.map((item) => item.data.satisfaction));
      cursor = page.nextCursor;
      cursors.push(cursor);
    } while (cursor !== null);
    expect(seen).toEqual([5, 3]);
    expect(cursors.map((next) => next !== null)).toEqual([true, false]);
  });

  it("refuses a from or till that is not a date-time", async () => {
    for (const query of ["?from=yesterday", "?till=2026-04-01", "?from=2026-13-01T00:00:00Z"]) {
      const response = await results(FEEDBACK, query);
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe("bad-request");
    }
  });

  it("refuses a leap second as any other malformed date-time", async () => {
    // RFC 3339 allows second 60, which the date-time check accepts but a Date cannot hold.
    for (const [name, value] of [
      ["from", "2026-04-01T23:59:60Z"],
      ["till", encodeURIComponent("2026-04-01T00:00:60+00:01")],
    ] as const) {
      const malformed = await results(FEEDBACK, `?${name}=not-a-date`);
      const leap = await results(FEEDBACK, `?${name}=${value}`);
      expect(leap.status).toBe(400);
      expect(leap.headers.get("content-type")).toBe(malformed.headers.get("content-type"));
      expect(await leap.json()).toStrictEqual(await malformed.json());
    }
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
      const id = await ownSurvey(adam, { definition: TEXT_SURVEY });
      await submitted(id, { data: { q1: "a" } });
      await submitted(id, { data: { q1: "b" } });
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
  it("answers 429 with Retry-After once an address has made too many requests", async (ctx) => {
    if (sandbox) ctx.skip("rate limits are server-only");
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

const PUBLIC_LAYOUT = "/public/surveys/{surveyId}/layouts/{kind}";

function publicLayout(surveyId: string, kind: string): Promise<Response> {
  return call("GET", PUBLIC_LAYOUT, { path: `/public/surveys/${surveyId}/layouts/${kind}` });
}

// The bridge's public layout reads exist in the hosted edition only.
describe.runIf(hosted)("getPublicLayout", () => {
  it("serves Customer feedback's layouts and its private question names, to anyone", async () => {
    const response = await publicLayout(FEEDBACK, "table");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { text: string; privateQuestions: string[] };
    expect(Object.keys(body)).toEqual(["text", "privateQuestions"]);
    expect(body.privateQuestions).toEqual(["receipt"]);
    expect(JSON.parse(body.text)).toMatchObject({ pageSize: 10 });
    const columns = (await (await publicLayout(FEEDBACK, "columns")).json()) as { text: string };
    expect(JSON.parse(columns.text)).toMatchObject({ newcolumnsvisibility: 0 });
  });

  it("follows Grant Access and answers null for a kind without a layout", async (ctx) => {
    const adam = await as(ctx, admin);
    const id = await ownSurvey(adam, { definition: TEXT_SURVEY });
    const text = ' { "elements": [{ "name": "q1" }],\n "pageSize": 5 }';
    const saved = await call("PUT", "/surveys/{surveyId}/layouts/{kind}", {
      path: `/surveys/${id}/layouts/summary`,
      headers: adam,
      body: { text },
    });
    expect(saved.status).toBe(204);
    await expectNotAvailable(await publicLayout(id, "summary"));

    const patched = await patch(adam, id, {
      settings: { publicResults: true, privateResultQuestions: ["q1"] },
    });
    expect(patched.status).toBe(200);
    const on = await publicLayout(id, "summary");
    expect(on.status).toBe(200);
    expect(await on.json()).toStrictEqual({ text, privateQuestions: ["q1"] });
    expect(await (await publicLayout(id, "table")).json()).toStrictEqual({
      text: null,
      privateQuestions: ["q1"],
    });

    expect((await patch(adam, id, { settings: { publicResults: false } })).status).toBe(200);
    await expectNotAvailable(await publicLayout(id, "summary"));
  });

  it("refuses an unknown survey and an unknown kind", async () => {
    await expectNotAvailable(await publicLayout(UNKNOWN_ID, "table"));
    expect((await publicLayout(FEEDBACK, "charts")).status).toBe(400);
  });
});

describe.skipIf(hosted)("getPublicLayout outside the hosted edition", () => {
  it("answers 404 not-found as for an unknown path", async () => {
    await expectNotRouted(await publicLayout(FEEDBACK, "table"));
  });
});
