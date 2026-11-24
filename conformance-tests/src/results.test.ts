/**
 * `listResults` and `deleteResponse` against the legacy fixtures: paging walks over the generated
 * survey `…a08` (1,500 rows) and `…a01` (5 rows), `from` and `till`, project members, refusals,
 * responses submitted during a walk, and deleting a run of saves.
 *
 * The data is shared by all test files and never reset (the Azurite replica keeps its result tables
 * between runs), so every test that submits creates its own survey in the admin's Personal scope
 * and submits only to that one. The fixture surveys `…a01`, `…a04` and `…a08` are read only: no
 * response, marker or view goes to them. Cleanup (archive, then delete) is registered with
 * `onTestFinished` right after a survey is created.
 */
import { describe, expect, it } from "vitest";
import {
  call,
  codeOf,
  as,
  ONE_QUESTION,
  listPage,
  walkPages,
  submitted,
  ownSurvey as ownHarnessSurvey,
  sandbox,
} from "./harness.js";
import { fixtureUsers } from "./sign-in.js";

const { owner, admin, member, outsider } = fixtureUsers;

const UNKNOWN_ID = "99999999-0000-4000-8000-a00000000099";
const FEEDBACK = "22222222-0000-4000-8000-a00000000001";
const CAMPAIGN = "22222222-0000-4000-8000-a00000000004";
const LARGE = "22222222-0000-4000-8000-a00000000008";

const RESULTS = "/surveys/{surveyId}/results";

type Headers = Record<string, string>;

interface Item {
  id: string;
  submittedAt: string;
  data: Record<string, unknown>;
  clientId?: string;
  respondentIp?: string;
  partial?: boolean;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
}

/** A published survey of the admin with one text question; its cleanup is registered. */
const ownSurvey = (headers: Headers): Promise<string> =>
  ownHarnessSurvey(headers, { definition: ONE_QUESTION });

function list(surveyId: string, query = "", headers?: Headers): Promise<Response> {
  return call("GET", RESULTS, {
    path: `/surveys/${surveyId}/results${query}`,
    ...(headers && { headers }),
  });
}

const page = (surveyId: string, query: string, headers: Headers): Promise<Page> =>
  listPage<Item>(RESULTS, `/surveys/${surveyId}/results${query}`, headers);

/** Follows `nextCursor` to the end; returns every page. */
const walk = (surveyId: string, limit: number, headers: Headers): Promise<Page[]> =>
  walkPages<Item>(RESULTS, `/surveys/${surveyId}/results?limit=${limit}`, headers);

/** The generated response n of `…a08`. */
const largeId = (n: number) => `66666666-0000-4000-8000-c${n.toString(16).padStart(11, "0")}`;

describe("listResults", () => {
  it("walks the 1,500 generated responses in pages of 500", async (ctx) => {
    if (sandbox) ctx.skip("needs survey a08, which the sandbox seed leaves out");
    const olivia = await as(ctx, owner);
    const pages = await walk(LARGE, 500, olivia);
    expect(pages.map((p) => p.items.length)).toEqual([500, 500, 500]);
    expect(pages.map((p) => p.nextCursor === null)).toEqual([false, false, true]);
    const items = pages.flatMap((p) => p.items);
    expect(items.map((item) => item.id)).toEqual(
      Array.from({ length: 1500 }, (_, i) => largeId(i + 1)),
    );
    expect(items[0]).toStrictEqual({
      id: "66666666-0000-4000-8000-c00000000001",
      submittedAt: "2026-05-01T08:00:00.000Z",
      data: { color: "Red", score: 1, subscribe: false, channels: ["Search"] },
    });
    expect(items[1499]?.id).toBe(largeId(1500));
  });

  it("serves 500 items by default and honours limit=1000", async (ctx) => {
    if (sandbox) ctx.skip("needs survey a08, which the sandbox seed leaves out");
    const olivia = await as(ctx, owner);
    const first = await page(LARGE, "", olivia);
    expect(first.items).toHaveLength(500);
    expect(first.nextCursor).not.toBeNull();

    const big = await page(LARGE, "?limit=1000", olivia);
    expect(big.items).toHaveLength(1000);
    const rest = await page(LARGE, `?limit=1000&cursor=${big.nextCursor}`, olivia);
    expect(rest.items).toHaveLength(500);
    expect(rest.nextCursor).toBeNull();
  });

  it("returns the five legacy rows of the feedback survey one by one, row two an open partial run", async (ctx) => {
    const olivia = await as(ctx, owner);
    const pages = await walk(FEEDBACK, 1, olivia);
    expect(pages).toHaveLength(5);
    const items = pages.flatMap((p) => p.items);
    expect(items.map((item) => item.id)).toEqual(
      [1, 2, 3, 4, 5].map((n) => `66666666-0000-4000-8000-a0000000000${n}`),
    );
    expect(items[1]).toMatchObject({ clientId: "client-0001" });
    expect(items[1]).toMatchObject({ partial: true });
    for (const item of items.filter((_, index) => index !== 1)) {
      expect(item).not.toHaveProperty("partial");
    }
    expect(items[2]).toMatchObject({ respondentIp: "203.0.113.7" });
  });

  it("lets a project member read the campaign survey's responses", async (ctx) => {
    const mia = await as(ctx, member);
    const result = await page(CAMPAIGN, "", mia);
    expect(result.items).toHaveLength(5);
    expect(result.nextCursor).toBeNull();
  });

  it("lists own submissions oldest first and keeps a walk stable across a new submission", async (ctx) => {
    const adam = await as(ctx, admin);
    const surveyId = await ownSurvey(adam);
    const ids = [
      await submitted(surveyId, { data: { q1: "a" } }),
      await submitted(surveyId, { data: { q1: "b" } }),
      await submitted(surveyId, { data: { q1: "c" } }),
    ];
    const all = await page(surveyId, "", adam);
    expect(all.items.map((item) => item.id)).toEqual(ids);
    expect(all.nextCursor).toBeNull();

    const first = await page(surveyId, "?limit=2", adam);
    expect(first.items.map((item) => item.id)).toEqual(ids.slice(0, 2));
    const fourth = await submitted(surveyId, { data: { q1: "d" } });
    const second = await page(surveyId, `?limit=2&cursor=${first.nextCursor}`, adam);
    expect(second.items.map((item) => item.id)).toEqual([ids[2], fourth]);
    expect(second.nextCursor).toBeNull();
  });

  it("does not merge responses of one client", async (ctx) => {
    const adam = await as(ctx, admin);
    const surveyId = await ownSurvey(adam);
    await submitted(surveyId, { data: { q1: "a" }, clientId: "same-client" });
    await submitted(surveyId, { data: { q1: "b" }, clientId: "same-client" });
    const result = await page(surveyId, "", adam);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.clientId)).toEqual(["same-client", "same-client"]);
  });

  it("refuses a bad limit or cursor with 400", async (ctx) => {
    if (sandbox) ctx.skip("needs survey a08, which the sandbox seed leaves out");
    const olivia = await as(ctx, owner);
    for (const query of ["?limit=0", "?limit=1001"]) {
      expect((await list(LARGE, query, olivia)).status).toBe(400);
    }
    const foreign = await page(FEEDBACK, "?limit=1", olivia);
    const upperCase = Buffer.from(
      JSON.stringify({
        v: 1,
        k: "results",
        s: LARGE,
        u: "2026-05-01T08:00:00.000Z",
        i: largeId(1).toUpperCase(),
      }),
    ).toString("base64url");
    for (const cursor of ["x", upperCase, foreign.nextCursor ?? ""]) {
      const response = await list(LARGE, `?cursor=${cursor}`, olivia);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "bad-request",
        detail: "Invalid cursor.",
      });
    }
  });

  it("answers 404 for an outsider and an unknown survey, 401 without a session, 400 for a long id", async (ctx) => {
    const oscar = await as(ctx, outsider);
    const olivia = await as(ctx, owner);
    for (const response of [await list(LARGE, "", oscar), await list(UNKNOWN_ID, "", olivia)]) {
      expect(response.status).toBe(404);
      expect(await codeOf(response)).toBe("not-found");
    }
    expect((await list(LARGE)).status).toBe(401);
    expect((await list("x".repeat(65), "", olivia)).status).toBe(400);
  });
});

describe("listResults from and till", () => {
  // Customer feedback: …a01 08:00:00.500, …a02 09:15 (an open partial run), …a03 10:30, …a04 11:45,
  // …a05 12:00 on 2026-04-01.
  const row = (n: number) => `66666666-0000-4000-8000-a0000000000${String(n)}`;
  const ids = async (query: string, headers: Headers): Promise<string[]> =>
    (await page(FEEDBACK, query, headers)).items.map((item) => item.id);

  it("keeps responses whose first save is strictly between from and till, paging inside them", async (ctx) => {
    const olivia = await as(ctx, owner);
    expect(await ids("?from=2026-04-01T09:00:00Z", olivia)).toEqual([
      row(2),
      row(3),
      row(4),
      row(5),
    ]);
    expect(await ids("?till=2026-04-01T10:30:00Z", olivia)).toEqual([row(1), row(2)]);
    expect(
      await ids("?from=2026-04-01T08:00:00.500Z&till=2026-04-01T12:00:00.000Z", olivia),
    ).toEqual([row(2), row(3), row(4)]);
    // 10:30Z written with an offset: compared as an instant, and exactly at the bound.
    expect(await ids(`?from=${encodeURIComponent("2026-04-01T12:30:00+02:00")}`, olivia)).toEqual([
      row(4),
      row(5),
    ]);

    const pages = await walkPages<Item>(
      RESULTS,
      `/surveys/${FEEDBACK}/results?limit=1&from=2026-04-01T08:00:00.500Z&till=2026-04-01T12:00:00Z`,
      olivia,
    );
    expect(pages.map((p) => p.items.map((item) => item.id))).toEqual([
      [row(2)],
      [row(3)],
      [row(4)],
    ]);
  });

  it("refuses a from or till that is not a date-time, a leap second as any other", async (ctx) => {
    const olivia = await as(ctx, owner);
    for (const query of ["?from=yesterday", "?till=2026-04-01", "?from=2026-13-01T00:00:00Z"]) {
      const response = await list(FEEDBACK, query, olivia);
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe("bad-request");
    }
    for (const [name, value] of [
      ["from", "2026-04-01T23:59:60Z"],
      ["till", encodeURIComponent("2026-04-01T00:00:60+00:01")],
    ] as const) {
      const malformed = await list(FEEDBACK, `?${name}=not-a-date`, olivia);
      const leap = await list(FEEDBACK, `?${name}=${value}`, olivia);
      expect(leap.status).toBe(400);
      expect(leap.headers.get("content-type")).toBe(malformed.headers.get("content-type"));
      expect(await leap.json()).toStrictEqual(await malformed.json());
    }
  });
});

describe("deleteResponse", () => {
  const ENGINEERING = "55555555-0000-4000-8000-a00000000002";
  const RESPONSE = "/surveys/{surveyId}/results/{responseId}";

  const remove = (surveyId: string, responseId: string, headers?: Headers): Promise<Response> =>
    call("DELETE", RESPONSE, {
      path: `/surveys/${surveyId}/results/${responseId}`,
      ...(headers && { headers }),
    });

  /** Whether the run page treats the client as having completed the survey. */
  const completed = async (surveyId: string, clientId: string): Promise<boolean> => {
    const response = await call("GET", "/public/surveys/{surveyId}", {
      path: `/public/surveys/${surveyId}?clientId=${clientId}`,
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { completed: boolean }).completed;
  };

  it("deletes the whole run by its last save's id and clears the respondent's state; then 404", async (ctx) => {
    const adam = await as(ctx, admin);
    const surveyId = await ownSurvey(adam);
    const before = await submitted(surveyId, { data: { q1: "before" } });
    const run = { clientId: "c-run" };
    const first = await submitted(surveyId, { data: { q1: "a" }, ...run, partial: true });
    await submitted(surveyId, { data: { q1: "b" }, ...run, partial: true });
    const last = await submitted(surveyId, { data: { q1: "c" }, ...run });
    const after = await submitted(surveyId, { data: { q1: "after" }, clientId: "c-other" });
    expect((await page(surveyId, "", adam)).items.map((item) => item.id)).toEqual([
      before,
      first,
      after,
    ]);
    expect(await completed(surveyId, "c-run")).toBe(true);

    const deleted = await remove(surveyId, last.toUpperCase(), adam);
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");

    expect((await page(surveyId, "", adam)).items.map((item) => item.id)).toEqual([before, after]);
    expect(await completed(surveyId, "c-run")).toBe(false);
    expect(await completed(surveyId, "c-other")).toBe(true);
    for (const id of [last, first]) {
      const again = await remove(surveyId, id, adam);
      expect(again.status).toBe(404);
      expect(await codeOf(again)).toBe("not-found");
    }
  });

  it("refuses without a CSRF token or a session, for outsiders and for unknown ids", async (ctx) => {
    const adam = await as(ctx, admin);
    const surveyId = await ownSurvey(adam);
    const id = await submitted(surveyId, { data: { q1: "a" } });

    // The sandbox has no CSRF token (D3 of self-hosted Step 9): its session is the msid cookie alone.
    if (!sandbox) {
      const noCsrf = await remove(surveyId, id, { cookie: adam.cookie ?? "" });
      expect(noCsrf.status).toBe(403);
      expect(await codeOf(noCsrf)).toBe("csrf-token-invalid");
    }
    expect((await remove(surveyId, id)).status).toBe(401);
    for (const response of [
      await remove(surveyId, id, await as(ctx, outsider)),
      await remove(UNKNOWN_ID, id, adam),
      await remove(surveyId, UNKNOWN_ID, adam),
      await remove(surveyId, "not-a-guid", adam),
    ]) {
      expect(response.status).toBe(404);
      expect(await codeOf(response)).toBe("not-found");
    }
    expect((await remove(surveyId, "x".repeat(65), adam)).status).toBe(400);
    expect((await page(surveyId, "", adam)).items.map((item) => item.id)).toEqual([id]);
  });

  it("answers 403 forbidden to a user who can see the survey but not modify it", async (ctx) => {
    const adam = await as(ctx, admin);
    const surveyId = await ownHarnessSurvey(adam, {
      definition: ONE_QUESTION,
      projectId: ENGINEERING,
    });
    const id = await submitted(surveyId, { data: { q1: "a" } });
    const olivia = await as(ctx, owner);
    const refused = await remove(surveyId, id, olivia);
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe("forbidden");
    expect((await page(surveyId, "", olivia)).items.map((item) => item.id)).toEqual([id]);
  });
});
