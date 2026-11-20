import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  send,
  startBridge,
  startStub,
  type RawResponse,
  type RunningBridge,
  type Stub,
} from "../testing/http.js";
import { DEFAULT_USER_ID, startFakeStudio, type FakeStudio } from "../testing/studio-stub.js";
import { storedSurvey, type StoredSurvey } from "../testing/studio-surveys.js";

const JSON_UTF8 = "application/json; charset=utf-8";
const HTML_UTF8 = "text/html; charset=utf-8";
const ZERO = "00000000-0000-0000-0000-000000000000";
const ANN = DEFAULT_USER_ID;
const BOB = "b0b00000-0000-4000-8000-000000000002";
const KEY = "key-of-ann";
const BOB_KEY = "key-of-bob";
const PROJECT = "56ddd87e-e091-47cd-8edb-4843ee17829c";
const UNKNOWN = "99999999-0000-4000-8000-000000000009";
const BOUNDARY = "----content-test";

function expectEmpty(answer: RawResponse, status: number): void {
  expect(answer.status).toBe(status);
  expect(answer.body.length).toBe(0);
  expect(answer.headers["content-type"]).toBeUndefined();
  expect(answer.headers.location).toBeUndefined();
}

function expectJson(answer: RawResponse, status: number, body: string): void {
  expect(answer.status).toBe(status);
  expect(answer.headers["content-type"]).toBe(JSON_UTF8);
  expect(answer.body.toString()).toBe(body);
}

const modify = (id: string) => JSON.stringify(`You are not authorized to modify the survey ${id}`);
const readHistory = (id: string) =>
  JSON.stringify(`You are not authorized to read the history of the survey ${id}`);

interface Part {
  name: string;
  value: string | Buffer;
  filename?: string;
}

function multipart(parts: Part[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    let head = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.filename !== undefined) head += `; filename="${part.filename}"`;
    chunks.push(Buffer.from(`${head}\r\n\r\n`), Buffer.from(part.value), Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

describe("the content actions", () => {
  let legacy: Stub;
  let studio: FakeStudio;
  let bridge: RunningBridge;

  beforeAll(async () => {
    legacy = await startStub((_request, res) => res.writeHead(200).end("old"));
    studio = await startFakeStudio();
    bridge = await startBridge({ studioUrl: `${studio.url}/api/v1`, legacyUrl: legacy.url });
  });

  afterAll(async () => {
    await bridge.close();
    await studio.close();
    await legacy.close();
  });

  beforeEach(() => {
    studio.reset();
    legacy.requests.length = 0;
    studio.credentials.set(KEY, "legacy");
    studio.credentials.set(BOB_KEY, "token");
    studio.users.set(BOB_KEY, BOB);
    studio.store.memberships.set(ANN, new Map([[PROJECT, "admin"]]));
    studio.store.memberships.set(BOB, new Map([[PROJECT, "user"]]));
  });

  function add(fields: Partial<StoredSurvey> = {}): StoredSurvey {
    const survey = storedSurvey({ ownerUserId: ANN, ...fields });
    studio.store.surveys.set(survey.id, survey);
    return survey;
  }

  function call(
    method: string,
    path: string,
    options: {
      key?: string;
      query?: string;
      headers?: [string, string][];
      body?: string | Buffer;
    } = {},
  ): Promise<RawResponse> {
    const key = options.key ?? KEY;
    const keyPart = key === "" ? "" : `accessKey=${encodeURIComponent(key)}`;
    const search = [keyPart, options.query ?? ""].filter((part) => part !== "").join("&");
    return send(`${bridge.url}/private/Surveys/${path}${search === "" ? "" : `?${search}`}`, {
      method,
      ...(options.headers !== undefined && { headers: options.headers }),
      ...(options.body !== undefined && { body: options.body }),
    });
  }

  const JSON_HEADERS: [string, string][] = [["Content-Type", "application/json"]];
  const putJson = (path: string, body: unknown, options: { key?: string } = {}) =>
    call("PUT", path, {
      ...options,
      headers: JSON_HEADERS,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const studioCalls = () => studio.requests.map((r) => `${r.method} ${r.url.split("?")[0]}`);

  describe("changeJson", () => {
    it("saves Json as the definition with If-Match *, adds a history entry, ignores Text and answers an empty 200", async () => {
      const survey = add({ definition: '{"title":"Old"}' });
      const answer = await putJson("changeJson", {
        Id: survey.id,
        Json: '{"title":"New","pages":[]}',
        Text: "ignored",
      });
      expectEmpty(answer, 200);
      expect(survey.definition).toBe('{"title":"New","pages":[]}');
      const save = studio.requests.find((r) => r.method === "PUT")!;
      expect(save.url).toBe(`/api/v1/surveys/${survey.id}/definition`);
      expect(save.headers["if-match"]).toBe("*");
      expect(save.headers.authorization).toBe(`Bearer ${KEY}`);

      // The save is a history entry, which listSurveyHistory shows.
      const listed = await fetch(`${studio.url}/api/v1/surveys/${survey.id}/history`, {
        headers: { authorization: `Bearer ${KEY}` },
      });
      const page = (await listed.json()) as { items: { id: string }[] };
      expect(page.items).toHaveLength(1);
      expect(page.items[0]!.id).toBe(survey.history[0]!.id);
    });

    it("reads property names in any letter case and ignores unknown ones", async () => {
      const survey = add();
      expectEmpty(
        await putJson("changeJson", `{"x":1,"ID":"${survey.id}","json":"{\\"a\\":1}"}`),
        200,
      );
      expect(survey.definition).toBe('{"a":1}');
    });

    it("answers 200 and saves nothing for an empty or missing Json, but only for a survey the caller may change", async () => {
      const survey = add();
      expectEmpty(await putJson("changeJson", { Id: survey.id, Json: "" }), 200);
      expectEmpty(await putJson("changeJson", { Id: survey.id }), 200);
      expect(survey.history).toHaveLength(0);
      expect(studio.requests.some((r) => r.url.endsWith("/definition"))).toBe(false);
      expectJson(await putJson("changeJson", { Id: UNKNOWN, Json: "" }), 400, modify(UNKNOWN));
    });

    it("refuses with the old Empty-400 a Json that is no JSON object, an object where a string belongs, or a bad body", async () => {
      const survey = add();
      for (const body of [
        { Id: survey.id, Json: "[1]" },
        { Id: survey.id, Json: "nope" },
        { Id: survey.id, Json: '"text"' },
        { Id: survey.id, Json: { a: 1 } },
        "",
        "null",
        "{broken",
      ]) {
        expectEmpty(await putJson("changeJson", body), 400);
      }
      expect(survey.history).toHaveLength(0);
    });

    it("answers the permission text, not 400, for a bad Json on a survey the caller may not change", async () => {
      const mine = add();
      expectJson(
        await putJson("changeJson", { Id: mine.id, Json: "[1]" }, { key: BOB_KEY }),
        400,
        modify(mine.id),
      );
    });

    it("refuses a content type that is not JSON with an empty 415", async () => {
      const survey = add();
      const form = await call("PUT", "changeJson", {
        headers: [["Content-Type", "application/x-www-form-urlencoded"]],
        body: `Id=${survey.id}&Json=%7B%7D`,
      });
      expectEmpty(form, 415);
      expectEmpty(await call("PUT", "changeJson", { body: "{}" }), 415);
    });

    it("answers the modify text for an unknown survey, a missing Id, a survey of another user and a read-only member", async () => {
      expectJson(await putJson("changeJson", { Id: UNKNOWN, Json: "{}" }), 400, modify(UNKNOWN));
      expectJson(await putJson("changeJson", { Json: "{}" }), 400, modify(ZERO));
      const others = add({ ownerUserId: BOB, creatorId: BOB });
      expectJson(
        await putJson("changeJson", { Id: others.id, Json: "{}" }),
        400,
        modify(others.id),
      );
      const inProject = add({ projectId: PROJECT, creatorId: ANN });
      expectJson(
        await putJson("changeJson", { Id: inProject.id, Json: "{}" }, { key: BOB_KEY }),
        400,
        modify(inProject.id),
      );
    });

    it("answers the bad-key answer without asking Studio for a missing key, and for one Studio refuses", async () => {
      expectEmpty(await putJson("changeJson", { Id: ZERO, Json: "{}" }, { key: "" }), 401);
      expect(studio.requests).toHaveLength(0);
      expectEmpty(await putJson("changeJson", { Id: ZERO, Json: "{}" }, { key: "wrong" }), 401);
    });

    it("answers an empty 400 for a definition Studio refuses and 500 for a Studio failure", async () => {
      const survey = add();
      studio.override = (request, res) => {
        if (request.method !== "PUT") return false;
        res.writeHead(422, { "content-type": "application/problem+json" }).end("{}");
        return true;
      };
      expectEmpty(await putJson("changeJson", { Id: survey.id, Json: "{}" }), 400);
      studio.override = (request, res) => {
        if (request.method !== "PUT") return false;
        res.writeHead(500).end();
        return true;
      };
      expectEmpty(await putJson("changeJson", { Id: survey.id, Json: "{}" }), 500);
    });
  });

  describe("changeTheme", () => {
    it("saves ThemeJson as the theme with If-Match * and ignores SurveyJson", async () => {
      const survey = add();
      const answer = await putJson("changeTheme", {
        Id: survey.id,
        ThemeJson: '{"themeName":"flat"}',
        SurveyJson: "ignored",
      });
      expectEmpty(answer, 200);
      expect(survey.theme).toEqual({ themeName: "flat" });
      const save = studio.requests.find((r) => r.method === "PUT")!;
      expect(save.url).toBe(`/api/v1/surveys/${survey.id}/theme`);
      expect(save.headers["if-match"]).toBe("*");
      expect(survey.history).toHaveLength(0);
    });

    it("leaves the theme as it is for a null or missing ThemeJson and empties it for an empty one", async () => {
      const survey = add({ theme: { themeName: "flat" } });
      expectEmpty(await putJson("changeTheme", { Id: survey.id, ThemeJson: null }), 200);
      expectEmpty(await putJson("changeTheme", { Id: survey.id }), 200);
      expect(survey.theme).toEqual({ themeName: "flat" });
      expect(studio.requests.some((r) => r.url.endsWith("/theme"))).toBe(false);
      expectEmpty(await putJson("changeTheme", { Id: survey.id, ThemeJson: "" }), 200);
      expect(survey.theme).toBeNull();
    });

    it("answers as changeJson does for bad bodies, refusals and a theme that is no JSON object", async () => {
      const survey = add({ theme: { themeName: "flat" } });
      expectEmpty(await putJson("changeTheme", { Id: survey.id, ThemeJson: "[1]" }), 400);
      expectEmpty(await putJson("changeTheme", { Id: survey.id, ThemeJson: { a: 1 } }), 400);
      expectEmpty(await putJson("changeTheme", ""), 400);
      expectEmpty(await call("PUT", "changeTheme", { body: "{}" }), 415);
      expectJson(
        await putJson("changeTheme", { Id: UNKNOWN, ThemeJson: "{}" }),
        400,
        modify(UNKNOWN),
      );
      expectEmpty(
        await putJson("changeTheme", { Id: survey.id, ThemeJson: "{}" }, { key: "" }),
        401,
      );
      expect(survey.theme).toEqual({ themeName: "flat" });
    });
  });

  describe("getHistoryPoint", () => {
    function withHistory(): { survey: StoredSurvey; pointId: string } {
      const survey = add();
      const pointId = "0a0a0a0a-0000-4000-8000-00000000000b";
      survey.history.push({
        id: pointId,
        definition: '{"title":"Old","when":"2026-01-02T03:04:05.000Z","n":1}',
        at: "2026-11-19T10:00:00.127Z",
        userId: ANN,
      });
      return { survey, pointId };
    }

    it("answers the stored definition as compact JSON without rewriting dates, with the id from the query or the route", async () => {
      const { survey, pointId } = withHistory();
      const expected = '{"title":"Old","when":"2026-01-02T03:04:05.000Z","n":1}';
      expectJson(
        await call("GET", "getHistoryPoint", { query: `id=${survey.id}&pointId=${pointId}` }),
        200,
        expected,
      );
      expectJson(
        await call("GET", `getHistoryPoint/${survey.id}`, {
          query: `pointId=${pointId.toUpperCase()}`,
        }),
        200,
        expected,
      );
    });

    it("answers Check parameter values for a point that does not exist or is malformed", async () => {
      const { survey } = withHistory();
      const check = JSON.stringify("Check parameter values.");
      expectJson(
        await call("GET", "getHistoryPoint", { query: `id=${survey.id}&pointId=${UNKNOWN}` }),
        400,
        check,
      );
      expectJson(
        await call("GET", "getHistoryPoint", { query: `id=${survey.id}&pointId=zz` }),
        400,
        check,
      );
      expectJson(await call("GET", "getHistoryPoint", { query: `id=${survey.id}` }), 400, check);
    });

    it("answers the read-history text for an unknown survey or one the caller cannot see, before looking at the point", async () => {
      const { survey, pointId } = withHistory();
      expectJson(
        await call("GET", "getHistoryPoint", { query: `id=${UNKNOWN}&pointId=${pointId}` }),
        400,
        readHistory(UNKNOWN),
      );
      expectJson(
        await call("GET", "getHistoryPoint", {
          query: `id=${survey.id}&pointId=${pointId}`,
          key: BOB_KEY,
        }),
        400,
        readHistory(survey.id),
      );
      expectJson(
        await call("GET", "getHistoryPoint", { query: "pointId=zz" }),
        400,
        readHistory(ZERO),
      );
    });

    it("answers the empty 401 for a missing key", async () => {
      expectEmpty(await call("GET", "getHistoryPoint", { key: "" }), 401);
      expect(studio.requests).toHaveLength(0);
    });
  });

  describe("uploadFiles", () => {
    const FORM_TYPE: [string, string][] = [
      ["Content-Type", `multipart/form-data; boundary=${BOUNDARY}`],
    ];
    const upload = (parts: Part[], options: { key?: string } = {}) =>
      call("POST", "uploadFiles", { ...options, headers: FORM_TYPE, body: multipart(parts) });

    it("stores each file of any field name once, in form order, and answers client name to stored name", async () => {
      const answer = await upload([
        { name: "a", value: "one", filename: "b.png" },
        { name: "note", value: "text" },
        { name: "zzz", value: "two", filename: "a.png" },
        { name: "a", value: "three", filename: "10.txt" },
      ]);
      expectJson(answer, 200, '{"b.png":"legacy-1","a.png":"legacy-2","10.txt":"legacy-3"}');
      expect(studio.store.uploads.map((u) => [u.fileName, u.bytes, u.userId])).toEqual([
        ["b.png", 3, ANN],
        ["a.png", 3, ANN],
        ["10.txt", 5, ANN],
      ]);
      const uploads = studio.requests.filter((r) => r.url.endsWith("/legacy-files"));
      expect(uploads).toHaveLength(3);
      expect(uploads.every((r) => r.headers.authorization === `Bearer ${KEY}`)).toBe(true);
    });

    it("keeps a repeated name where it stood with the last stored name, and never reuses a name", async () => {
      const answer = await upload([
        { name: "f", value: "1", filename: "x.png" },
        { name: "f", value: "2", filename: "y.png" },
        { name: "f", value: "3", filename: "x.png" },
      ]);
      expectJson(answer, 200, '{"x.png":"legacy-3","y.png":"legacy-2"}');
      expect(studio.store.uploads).toHaveLength(3);
    });

    it("answers {} for a form without files and stores nothing", async () => {
      expectJson(await upload([{ name: "a", value: "b" }]), 200, "{}");
      expectJson(
        await call("POST", "uploadFiles", {
          headers: [["Content-Type", "application/x-www-form-urlencoded"]],
          body: "a=b",
        }),
        200,
        "{}",
      );
      expect(studio.store.uploads).toHaveLength(0);
    });

    it("answers an empty 400 for a body that is not a form, after checking the key", async () => {
      expectEmpty(await call("POST", "uploadFiles", { headers: JSON_HEADERS, body: "{}" }), 400);
      expectEmpty(await call("POST", "uploadFiles", { body: "x" }), 400);
      const bad = await call("POST", "uploadFiles", {
        key: "wrong",
        headers: JSON_HEADERS,
        body: "{}",
      });
      expect(bad.body.toString()).toBe("The accessKey 'wrong' is incorrect.");
    });

    it("maps every file to the zero GUID for the documentation placeholder key, without storing or asking Studio", async () => {
      const answer = await upload(
        [
          { name: "a", value: "1", filename: "x.png" },
          { name: "b", value: "2", filename: "y.png" },
        ],
        { key: "<your_access_key>" },
      );
      expectJson(answer, 200, `{"x.png":"${ZERO}","y.png":"${ZERO}"}`);
      expect(studio.requests).toHaveLength(0);
      expectEmpty(
        await call("POST", "uploadFiles", {
          key: "<your_access_key>",
          headers: JSON_HEADERS,
          body: "{}",
        }),
        400,
      );
    });

    it("answers the bad-key text, HTML-encoded and as text/html, for a missing, wrong or refused key", async () => {
      for (const [key, shown] of [
        ["", ""],
        ["wrong", "wrong"],
        ["<b>x</b>", "&lt;b&gt;x&lt;/b&gt;"],
      ] as const) {
        const answer = await upload([{ name: "a", value: "1", filename: "x.png" }], { key });
        expect(answer.status).toBe(200);
        expect(answer.headers["content-type"]).toBe(HTML_UTF8);
        expect(answer.body.toString()).toBe(`The accessKey '${shown}' is incorrect.`);
      }
      expect(studio.store.uploads).toHaveLength(0);
    });

    it("answers an empty 400 for a file Studio refuses and 500 for a Studio failure", async () => {
      studio.override = (request, res) => {
        if (!request.url.endsWith("/legacy-files")) return false;
        res.writeHead(413, { "content-type": "application/problem+json" }).end("{}");
        return true;
      };
      expectEmpty(await upload([{ name: "a", value: "1", filename: "x.png" }]), 400);
      studio.override = (request, res) => {
        if (!request.url.endsWith("/legacy-files")) return false;
        res.writeHead(404, { "content-type": "application/problem+json" }).end("{}");
        return true;
      };
      expectEmpty(await upload([{ name: "a", value: "1", filename: "x.png" }]), 500);
    });
  });

  it("answers on both prefixes, in any letter case, with a trailing slash", async () => {
    const survey = add();
    const answer = await send(`${bridge.url}/PRIVATE/v1/surveys/CHANGEJSON/?ACCESSKEY=${KEY}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ Id: survey.id, Json: "{}" }),
    });
    expectEmpty(answer, 200);
    expect(studioCalls()).toContain(`PUT /api/v1/surveys/${survey.id}/definition`);
    expect(legacy.requests).toHaveLength(0);
  });
});
