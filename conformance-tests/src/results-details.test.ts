/**
 * `exportResults` (JSON and CSV, format negotiation, file names), the respondent IP rule (R12) and
 * `deleteResults` against the legacy fixtures.
 *
 * The data is shared by all test files and never reset (the Azurite replica keeps its tables between
 * runs), so every test that writes creates its own survey in the admin's Personal scope (or Adam's
 * survey in Engineering for a permission check) and writes only to that one. The fixture surveys
 * `…a01`, `…a04` and `…a08` are read only: no response, marker, file, view, setting, private-question
 * list or results deletion goes to them. Cleanup (archive, then delete) is registered with
 * `onTestFinished` right after a survey is created.
 */
import { describe, expect, it } from "vitest";
import {
  call,
  codeOf,
  upload,
  as,
  ONE_QUESTION,
  submitted,
  walkItems,
  ownSurvey as ownHarnessSurvey,
  type OwnSurveyOptions,
} from "./harness.js";
import { fixtureUsers } from "./sign-in.js";

const { owner, admin, member, outsider } = fixtureUsers;

const UNKNOWN_ID = "99999999-0000-4000-8000-a00000000099";
const FEEDBACK = "22222222-0000-4000-8000-a00000000001";
const CAMPAIGN = "22222222-0000-4000-8000-a00000000004";
const LARGE = "22222222-0000-4000-8000-a00000000008";
const ENGINEERING = "55555555-0000-4000-8000-a00000000002";

const RESULTS = "/surveys/{surveyId}/results";
const EXPORT = "/surveys/{surveyId}/results/export";
const STATS = "/surveys/{surveyId}/results/stats";
const MERGE_PATCH = "application/merge-patch+json";

/** The data URL of the fixture response 4's receipt (`suite/expected.ts`). */
const RECEIPT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** A valid 1×1 PNG. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

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

const merge = (headers: Headers): Headers => ({ "content-type": MERGE_PATCH, ...headers });

function patch(headers: Headers, id: string, body: unknown): Promise<Response> {
  return call("PATCH", "/surveys/{surveyId}", {
    path: `/surveys/${id}`,
    headers: merge(headers),
    body,
  });
}

/** A published survey with one text question `q1` (by default); its cleanup is registered. */
const ownSurvey = (
  headers: Headers,
  options: Omit<OwnSurveyOptions, "published"> = {},
): Promise<string> => ownHarnessSurvey(headers, { definition: ONE_QUESTION, ...options });

function exported(surveyId: string, headers?: Headers, query = "", accept?: string) {
  return call("GET", EXPORT, {
    path: `/surveys/${surveyId}/results/export${query}`,
    headers: { ...headers, ...(accept !== undefined && { accept }) },
  });
}

const listAll = (surveyId: string, headers: Headers): Promise<Item[]> =>
  walkItems<Item>(RESULTS, `/surveys/${surveyId}/results?limit=500`, headers);

async function statsOf(surveyId: string, headers: Headers): Promise<unknown> {
  const response = await call("GET", STATS, {
    path: `/surveys/${surveyId}/results/stats`,
    headers,
  });
  expect(response.status).toBe(200);
  return response.json();
}

const BOM = "﻿";

/** The CSV text after the BOM; fails unless the file starts with one. */
async function csvOf(response: Response): Promise<string> {
  const bytes = Buffer.from(await response.arrayBuffer());
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return bytes.toString("utf8").slice(BOM.length);
}

/** CSV text to records (no embedded line breaks in the large file's data). */
const recordsOf = (text: string): string[] => text.split("\r\n").slice(0, -1);

describe("exportResults of the fixtures", () => {
  it("downloads Customer feedback as JSON, the items of a listResults walk", async (ctx) => {
    const olivia = await as(ctx, owner);
    const response = await exported(FEEDBACK, olivia, "?format=json");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="Customer feedback.json"; filename*=UTF-8''Customer%20feedback.json`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Item[];
    expect(body).toHaveLength(5);
    expect(body).toStrictEqual(await listAll(FEEDBACK, olivia));
    expect(body[1]?.clientId).toBe("client-0001");
    expect(body[2]?.respondentIp).toBe("203.0.113.7");
    for (const item of body) expect(item).not.toHaveProperty("partial");
  });

  it("downloads Customer feedback as CSV with a byte order mark and CRLF lines", async (ctx) => {
    const response = await exported(FEEDBACK, await as(ctx, owner), "?format=csv");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(await csvOf(response)).toBe(
      [
        "Submitted,IPAddress,satisfaction,receipt,ClientId",
        "2026-04-01T08:00:00.500Z,,4,,",
        "2026-04-01T09:15:00.000Z,,2,,client-0001",
        "2026-04-01T10:30:00.000Z,203.0.113.7,5,,",
        `2026-04-01T11:45:00.000Z,,3,"[{""name"":""receipt.png"",""type"":""image/png"",""content"":""${RECEIPT_PNG}""}]",`,
        "2026-04-01T12:00:00.000Z,,1,dxsimage:99999999-0000-4000-8000-a00000000002.png,",
      ]
        .map((line) => `${line}\r\n`)
        .join(""),
    );
  });

  it("streams all 1,500 responses of API created, as JSON and as CSV", async (ctx) => {
    const olivia = await as(ctx, owner);
    const asJson = await exported(LARGE, olivia, "", "application/json");
    expect(asJson.status).toBe(200);
    const items = (await asJson.json()) as Item[];
    expect(items).toHaveLength(1500);
    expect(items[0]?.id).toBe("66666666-0000-4000-8000-c00000000001");
    expect(items[1499]?.id).toBe("66666666-0000-4000-8000-c000000005dc");

    const asCsv = await exported(LARGE, olivia, "?format=csv");
    expect(asCsv.headers.get("content-disposition")).toBe(
      `attachment; filename="API created.csv"; filename*=UTF-8''API%20created.csv`,
    );
    const records = recordsOf(await csvOf(asCsv));
    expect(records).toHaveLength(1501);
    expect(records[0]).toBe("Submitted,color,score,subscribe,channels,comment,ClientId");
    expect(records[1]).toBe('2026-05-01T08:00:00.000Z,Red,1,false,"[""Search""]",,');
    expect(records[1500]).toBe('2026-05-01T20:30:00.000Z,Blue,5,true,"[""Ad""]",Comment 1500,');
  });

  it("negotiates the format from format and Accept", async (ctx) => {
    const olivia = await as(ctx, owner);
    const typeOf = async (query: string, accept?: string): Promise<string | null> => {
      const response = await exported(FEEDBACK, olivia, query, accept);
      expect(response.status).toBe(200);
      await response.arrayBuffer();
      return response.headers.get("content-type");
    };
    const JSON_TYPE = "application/json; charset=utf-8";
    const CSV_TYPE = "text/csv; charset=utf-8";
    expect(await typeOf("", "text/csv")).toBe(CSV_TYPE);
    expect(await typeOf("", "text/*")).toBe(CSV_TYPE);
    expect(await typeOf("", "*/*")).toBe(JSON_TYPE);
    expect(await typeOf("", "text/csv;q=0.5, application/json")).toBe(JSON_TYPE);
    expect(await typeOf("?format=csv", "application/xml")).toBe(CSV_TYPE);
    expect(await typeOf("?format=json", "text/csv")).toBe(JSON_TYPE);

    const refused = await exported(FEEDBACK, olivia, "", "application/xml");
    expect(refused.status).toBe(406);
    expect(refused.headers.get("content-type")).toContain("application/problem+json");
    expect(await codeOf(refused)).toBe("not-acceptable");

    const unknown = await exported(FEEDBACK, olivia, "?format=xlsx");
    expect(unknown.status).toBe(400);
    expect(await codeOf(unknown)).toBe("bad-request");
  });

  it("lets a project member download and hides surveys from outsiders", async (ctx) => {
    const mia = await exported(CAMPAIGN, await as(ctx, member), "?format=json");
    expect(mia.status).toBe(200);
    await mia.arrayBuffer();

    const oscar = await exported(LARGE, await as(ctx, outsider));
    expect(oscar.status).toBe(404);
    expect(await codeOf(oscar)).toBe("not-found");

    const unknown = await exported(UNKNOWN_ID, await as(ctx, owner));
    expect(unknown.status).toBe(404);
    expect(await codeOf(unknown)).toBe("not-found");

    expect((await exported(FEEDBACK)).status).toBe(401);
  });
});

describe("exportResults of own surveys", () => {
  it("exports a survey without responses: [] and a header-only CSV", async (ctx) => {
    const adam = await as(ctx, admin);
    const id = await ownSurvey(adam);
    const asJson = await exported(id, adam, "?format=json");
    expect(asJson.status).toBe(200);
    expect(await asJson.json()).toStrictEqual([]);
    expect(await csvOf(await exported(id, adam, "?format=csv"))).toBe("Submitted,q1,ClientId\r\n");
  });

  it("names the file after the survey, with an ASCII fallback and the UTF-8 name", async (ctx) => {
    const adam = await as(ctx, admin);
    const id = await ownSurvey(adam, { name: 'Größe "Q3" 😀' });
    const response = await exported(id, adam, "?format=csv");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="Gr__e _Q3_ __.csv"; filename*=UTF-8''Gr%C3%B6%C3%9Fe%20%22Q3%22%20%F0%9F%98%80.csv`,
    );
    await response.arrayBuffer();
  });

  it("includes the respondent IP while the setting is on, and never publicly (R12)", async (ctx) => {
    const adam = await as(ctx, admin);
    const id = await ownSurvey(adam);
    const on = await patch(adam, id, {
      settings: { storeRespondentIp: true, publicResults: true },
    });
    expect(on.status).toBe(200);
    await submitted(id, { data: { q1: "a" } }, { "x-forwarded-for": "203.0.113.9" });

    const [first] = await listAll(id, adam);
    const ip = first?.respondentIp ?? "";
    expect(ip).not.toBe("");

    const asJson = (await (await exported(id, adam, "?format=json")).json()) as Item[];
    expect(asJson[0]?.respondentIp).toBe(ip);
    const lines = (await csvOf(await exported(id, adam, "?format=csv"))).split("\r\n");
    expect(lines[0]).toBe("Submitted,IPAddress,q1,ClientId");
    expect(lines[1]).toBe(`${first?.submittedAt},${ip},a,`);

    const publicPage = await call("GET", "/public/surveys/{surveyId}/results", {
      path: `/public/surveys/${id}/results`,
    });
    expect(publicPage.status).toBe(200);
    expect(((await publicPage.json()) as Page).items).toStrictEqual([
      { submittedAt: first?.submittedAt, data: { q1: "a" } },
    ]);

    expect((await patch(adam, id, { settings: { storeRespondentIp: false } })).status).toBe(200);
    await submitted(id, { data: { q1: "b" } }, { "x-forwarded-for": "203.0.113.9" });
    const all = await listAll(id, adam);
    expect(all).toHaveLength(2);
    expect(all[0]?.respondentIp).toBe(ip);
    expect(all[1]).not.toHaveProperty("respondentIp");
    expect((await csvOf(await exported(id, adam, "?format=csv"))).split("\r\n")[0]).toBe(
      "Submitted,q1,ClientId",
    );
  });
});

describe("deleteResults", () => {
  it("deletes responses, markers and respondent files, and nothing else", async (ctx) => {
    const adam = await as(ctx, admin);
    const definition = {
      cookieName: "c-del",
      pages: [
        {
          name: "page1",
          elements: [
            { type: "text", name: "q1" },
            { type: "file", name: "doc" },
          ],
        },
      ],
    };
    const id = await ownSurvey(adam, { definition });

    const respondentForm = new FormData();
    respondentForm.append(
      "file",
      new Blob([new Uint8Array(PNG_1X1)], { type: "image/png" }),
      "a.png",
    );
    const respondentUpload = await upload("/public/surveys/{surveyId}/files", {
      path: `/public/surveys/${id}/files`,
      form: respondentForm,
    });
    expect(respondentUpload.status).toBe(201);
    const respondentFile = (await respondentUpload.json()) as { id: string; url: string };

    const assetForm = new FormData();
    assetForm.append("file", new Blob([new Uint8Array(PNG_1X1)], { type: "image/png" }), "b.png");
    const assetUpload = await upload("/surveys/{surveyId}/assets", {
      path: `/surveys/${id}/assets`,
      headers: adam,
      form: assetForm,
    });
    expect(assetUpload.status).toBe(201);
    const asset = (await assetUpload.json()) as { id: string };

    await submitted(id, {
      data: { q1: "a", doc: [{ name: "a.png", type: "image/png", content: respondentFile.url }] },
      clientId: "c-del",
    });
    const view = { elements: [{ name: "q1", isVisible: false }] };
    const saved = await call("PUT", "/surveys/{surveyId}/views/{view}", {
      path: `/surveys/${id}/views/summary`,
      headers: adam,
      body: view,
    });
    expect(saved.status).toBe(204);
    const privacy = await patch(adam, id, { settings: { privateResultQuestions: ["q1"] } });
    expect(privacy.status).toBe(200);
    const before = (await privacy.json()) as { updatedAt: string };
    expect(await statsOf(id, adam)).toMatchObject({ count: 1 });
    const completedBefore = await call("GET", "/public/surveys/{surveyId}", {
      path: `/public/surveys/${id}?clientId=c-del`,
    });
    expect(((await completedBefore.json()) as { completed: boolean }).completed).toBe(true);

    const deleted = await call("DELETE", RESULTS, {
      path: `/surveys/${id}/results`,
      headers: adam,
    });
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");

    expect(await statsOf(id, adam)).toStrictEqual({
      count: 0,
      firstSubmittedAt: null,
      lastSubmittedAt: null,
    });
    expect(await listAll(id, adam)).toStrictEqual([]);
    const gone = await call("GET", "/public/files/{fileId}", {
      path: `/public/files/${respondentFile.id}`,
    });
    expect(gone.status).toBe(404);
    const kept = await call("GET", "/public/files/{fileId}", { path: `/public/files/${asset.id}` });
    expect(kept.status).toBe(200);
    await kept.arrayBuffer();
    const completedAfter = await call("GET", "/public/surveys/{surveyId}", {
      path: `/public/surveys/${id}?clientId=c-del`,
    });
    expect(((await completedAfter.json()) as { completed: boolean }).completed).toBe(false);
    const savedView = await call("GET", "/surveys/{surveyId}/views/{view}", {
      path: `/surveys/${id}/views/summary`,
      headers: adam,
    });
    expect(savedView.status).toBe(200);
    expect(await savedView.json()).toStrictEqual(view);
    const after = (await (
      await call("GET", "/surveys/{surveyId}", { path: `/surveys/${id}`, headers: adam })
    ).json()) as { updatedAt: string; settings: { privateResultQuestions: string[] } };
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.settings.privateResultQuestions).toEqual(["q1"]);

    const again = await call("DELETE", RESULTS, { path: `/surveys/${id}/results`, headers: adam });
    expect(again.status).toBe(204);
    await submitted(id, { data: { q1: "b" }, clientId: "c-del" });
    expect(await statsOf(id, adam)).toMatchObject({ count: 1 });
  });

  it("refuses without a CSRF token, without a session and for callers who cannot see it", async (ctx) => {
    const adam = await as(ctx, admin);
    const id = await ownSurvey(adam);
    await submitted(id, { data: { q1: "a" } });
    const url = `/surveys/${id}/results`;

    const noCsrf = await call("DELETE", RESULTS, {
      path: url,
      headers: { cookie: adam.cookie ?? "" },
    });
    expect(noCsrf.status).toBe(403);
    expect(await codeOf(noCsrf)).toBe("csrf-token-invalid");

    expect((await call("DELETE", RESULTS, { path: url })).status).toBe(401);

    const oscar = await call("DELETE", RESULTS, { path: url, headers: await as(ctx, outsider) });
    expect(oscar.status).toBe(404);
    expect(await codeOf(oscar)).toBe("not-found");

    const unknown = await call("DELETE", RESULTS, {
      path: `/surveys/${UNKNOWN_ID}/results`,
      headers: adam,
    });
    expect(unknown.status).toBe(404);
    expect(await statsOf(id, adam)).toMatchObject({ count: 1 });
  });

  it("answers 403 forbidden to a user who can see the survey but not modify it", async (ctx) => {
    const adam = await as(ctx, admin);
    const id = await ownSurvey(adam, { projectId: ENGINEERING });
    await submitted(id, { data: { q1: "a" } });
    const olivia = await as(ctx, owner);
    const refused = await call("DELETE", RESULTS, {
      path: `/surveys/${id}/results`,
      headers: olivia,
    });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe("forbidden");
    expect(await statsOf(id, olivia)).toMatchObject({ count: 1 });
  });
});
