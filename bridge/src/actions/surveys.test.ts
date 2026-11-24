import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  send,
  sendRaw,
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
const STRANGERS = "77777777-0000-4000-8000-000000000007";
const UNKNOWN = "99999999-0000-4000-8000-000000000009";
const PUBLISH_ID = "1d2c3b4a-0000-4000-8000-0000000000aa";

const FORM: [string, string][] = [["Content-Type", "application/x-www-form-urlencoded"]];

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

function expectText(answer: RawResponse, text: string): void {
  expect(answer.status).toBe(200);
  expect(answer.headers["content-type"]).toBe(HTML_UTF8);
  expect(answer.body.toString()).toBe(text);
}

const modify = (id: string) => JSON.stringify(`You are not authorized to modify the survey ${id}`);
const getInfo = (id: string) =>
  JSON.stringify(`You are not authorized to get this information about the survey ${id}`);

describe("the survey record actions", () => {
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

  /** A request to `private/Surveys/<path>` with Ann's key (or `key`), `query` appended. */
  function call(
    method: string,
    path: string,
    query = "",
    options: { key?: string; headers?: [string, string][]; body?: string; prefix?: string } = {},
  ): Promise<RawResponse> {
    const key = options.key ?? KEY;
    const keyPart = key === "" ? "" : `accessKey=${encodeURIComponent(key)}`;
    const search = [keyPart, query].filter((part) => part !== "").join("&");
    return send(
      `${bridge.url}${options.prefix ?? "/private/Surveys"}/${path}${search === "" ? "" : `?${search}`}`,
      {
        method,
        ...(options.headers !== undefined && { headers: options.headers }),
        ...(options.body !== undefined && { body: options.body }),
      },
    );
  }

  const studioCalls = () => studio.requests.map((r) => `${r.method} ${r.url}`);

  describe("getActive and getArchive", () => {
    it("lists the caller's active Personal surveys, newest first, as the old records with list dates", async () => {
      const older = add({
        id: "f6f1c966-8d49-46d0-94d3-975c53b6577d",
        name: "NPS",
        postId: "13f2e886-9c38-42f2-b814-d0900cf06a19",
        resultId: "929d229c-9f78-40ec-aa47-0eea718a53b2",
        createdAt: "2025-01-02T03:04:05.110Z",
        updatedAt: "2026-11-19T10:00:00.127Z",
        theme: { themeName: "flat" },
      });
      const newer = add({ name: "Newer", updatedAt: "2026-11-19T11:00:00.000Z" });
      add({ name: "Archived", archived: true });
      add({ name: "Bob's", ownerUserId: BOB, creatorId: BOB });
      add({ name: "In the project", projectId: PROJECT });

      const answer = await call("GET", "getActive");
      expect(answer.status).toBe(200);
      expect(answer.headers["content-type"]).toBe(JSON_UTF8);
      const list = JSON.parse(answer.body.toString()) as Record<string, unknown>[];
      expect(list.map((survey) => survey.Id)).toEqual([newer.id, older.id]);
      expect(JSON.stringify(list[1])).toBe(
        `{"Name":"NPS","IsArchived":false,"UserId":"${ANN}","CreatorId":"${ANN}",` +
          `"PostId":"13f2e886-9c38-42f2-b814-d0900cf06a19",` +
          `"ResultId":"929d229c-9f78-40ec-aa47-0eea718a53b2","PublishId":null,` +
          `"IsPublished":true,"UseCookies":false,"UpdatedOn":"2026-11-19T10:00:00.127Z",` +
          `"CreatedAt":"2025-01-02T03:04:05.11Z","AllowAccessResult":false,` +
          `"StoreIPAddress":false,"Theme":"{\\"themeName\\":\\"flat\\"}","Json":null,` +
          `"Id":"f6f1c966-8d49-46d0-94d3-975c53b6577d"}`,
      );
      expect(list[0]!.Theme).toBeNull();
      const [list1, me] = studio.requests;
      expect(list1!.url).toMatch(/^\/api\/v1\/surveys\?/);
      const query = new URL(list1!.url, "http://x").searchParams;
      expect(query.get("archived")).toBe("false");
      expect(query.get("include")).toBe("theme");
      expect(query.has("project")).toBe(false);
      expect(list1!.headers.authorization).toBe(`Bearer ${KEY}`);
      expect(`${me!.method} ${me!.url}`).toBe("GET /api/v1/me");
      expect(legacy.requests).toEqual([]);
    });

    it("answers [] when there are none", async () => {
      expectJson(await call("GET", "getActive"), 200, "[]");
    });

    it("answers a nameless survey's name as null", async () => {
      add({ name: "" });
      const answer = await call("GET", "getActive");
      expect(answer.body.toString()).toMatch(/^\[\{"Name":null,"IsArchived":false,/);
    });

    it("lists the archived ones for getArchive", async () => {
      add({ name: "Active" });
      const archived = add({ name: "Archived", archived: true });
      const answer = await call("GET", "getArchive", "", { prefix: "/PRIVATE/v1/surveys" });
      const list = JSON.parse(answer.body.toString()) as Record<string, unknown>[];
      expect(list.map((survey) => [survey.Id, survey.IsArchived])).toEqual([[archived.id, true]]);
    });

    it("lists a project's surveys for an ownerId the caller belongs to, its owner the project", async () => {
      add({ name: "Personal" });
      const inProject = add({ name: "Project", projectId: PROJECT, creatorId: BOB });
      const answer = await call("GET", "getActive/", `ownerId=${PROJECT.toUpperCase()}`);
      const list = JSON.parse(answer.body.toString()) as Record<string, unknown>[];
      expect(list.map((survey) => [survey.Id, survey.UserId, survey.CreatorId])).toEqual([
        [inProject.id, PROJECT, BOB],
      ]);
      // No Personal survey in the list: the caller's own ID is not needed.
      expect(studioCalls()).toHaveLength(1);
    });

    it("falls back to Personal for any other ownerId, as the old API", async () => {
      const personal = add({ name: "Personal" });
      add({ name: "Project", projectId: PROJECT });
      for (const ownerId of [STRANGERS, ANN, "not-a-guid", ""]) {
        const answer = await call("GET", "getActive", `ownerId=${ownerId}`);
        const list = JSON.parse(answer.body.toString()) as Record<string, unknown>[];
        expect(
          list.map((survey) => survey.Id),
          ownerId,
        ).toEqual([personal.id]);
      }
    });

    it("reads every page of Studio's list", async () => {
      studio.store.surveyPageSize = 1;
      for (let index = 0; index < 3; index += 1) {
        add({ name: `S${index}`, updatedAt: `2026-11-19T1${index}:00:00.000Z` });
      }
      const answer = await call("GET", "getActive");
      const list = JSON.parse(answer.body.toString()) as Record<string, unknown>[];
      expect(list.map((survey) => survey.Name)).toEqual(["S2", "S1", "S0"]);
      expect(studioCalls().filter((c) => c.startsWith("GET /api/v1/surveys"))).toHaveLength(3);
    });

    it("answers a missing key without asking Studio, and a refused key, with an empty 401", async () => {
      expectEmpty(await call("GET", "getActive", "", { key: "" }), 401);
      expect(studio.requests).toEqual([]);
      expectEmpty(await call("GET", "getActive", "", { key: "revoked" }), 401);
    });

    it("passes Studio's 429 on empty", async () => {
      studio.override = (_request, res) => (res.writeHead(429).end(), true);
      expectEmpty(await call("GET", "getActive"), 429);
    });
  });

  describe("getSurveyInfo", () => {
    it("answers the record with single-read dates and the HTML-encoded JSON", async () => {
      const survey = add({
        id: "f6f1c966-8d49-46d0-94d3-975c53b6577d",
        name: "NPS",
        postId: "13f2e886-9c38-42f2-b814-d0900cf06a19",
        resultId: "929d229c-9f78-40ec-aa47-0eea718a53b2",
        createdAt: "2025-01-02T03:04:05.110Z",
        updatedAt: "2026-11-19T10:00:00.127Z",
        theme: { themeName: "flat" },
        legacyPublishId: PUBLISH_ID,
        definition: '{"pages":[{"name":"page1","title":"<b>Tom\'s</b> & café"}]}',
      });
      const answer = await call("GET", "getSurveyInfo", `surveyId=${survey.id}`);
      expectJson(
        answer,
        200,
        `{"Info":{"Name":"NPS","IsArchived":false,"UserId":"${ANN}","CreatorId":"${ANN}",` +
          `"PostId":"13f2e886-9c38-42f2-b814-d0900cf06a19",` +
          `"ResultId":"929d229c-9f78-40ec-aa47-0eea718a53b2","PublishId":"${PUBLISH_ID}",` +
          `"IsPublished":true,"UseCookies":false,"UpdatedOn":"2026-11-19T10:00:00.127",` +
          `"CreatedAt":"2025-01-02T03:04:05.11","AllowAccessResult":false,` +
          `"StoreIPAddress":false,"Theme":"{\\"themeName\\":\\"flat\\"}","Json":null,` +
          `"Id":"f6f1c966-8d49-46d0-94d3-975c53b6577d"},` +
          `"Json":"{&quot;pages&quot;:[{&quot;name&quot;:&quot;page1&quot;,` +
          `&quot;title&quot;:&quot;&lt;b&gt;Tom&#39;s&lt;/b&gt; &amp; caf&#233;&quot;}]}"}`,
      );
    });

    it("reads a project survey only with its project as ownerId", async () => {
      const survey = add({ projectId: PROJECT, theme: null });
      const allowed = await call(
        "GET",
        "getSurveyInfo",
        `surveyId=${survey.id}&ownerId=${PROJECT}`,
      );
      expect(allowed.status).toBe(200);
      const info = (JSON.parse(allowed.body.toString()) as { Info: Record<string, unknown> }).Info;
      expect(info.UserId).toBe(PROJECT);
      expect(info.Theme).toBeNull();
      expectEmpty(await call("GET", "getSurveyInfo", `surveyId=${survey.id}`), 500);
      expectEmpty(
        await call("GET", "getSurveyInfo", `surveyId=${survey.id}&ownerId=${STRANGERS}`),
        500,
      );
    });

    it("answers an unknown, malformed or invisible survey with an empty 400", async () => {
      const bobs = add({ ownerUserId: BOB, creatorId: BOB });
      for (const surveyId of [UNKNOWN, "zz", bobs.id]) {
        expectEmpty(await call("GET", "getSurveyInfo", `surveyId=${surveyId}`), 400);
      }
      expectEmpty(await call("GET", "getSurveyInfo"), 400);
    });
  });

  describe("create", () => {
    it("creates an empty Personal survey and answers its record with single-read dates", async () => {
      const answer = await call("POST", "create", "name=My%20survey");
      expect(answer.status).toBe(200);
      expect(answer.headers["content-type"]).toBe(JSON_UTF8);
      const record = JSON.parse(answer.body.toString()) as Record<string, unknown>;
      expect(Object.keys(record)).toEqual([
        "Name",
        "IsArchived",
        "UserId",
        "CreatorId",
        "PostId",
        "ResultId",
        "PublishId",
        "IsPublished",
        "UseCookies",
        "UpdatedOn",
        "CreatedAt",
        "AllowAccessResult",
        "StoreIPAddress",
        "Theme",
        "Json",
        "Id",
      ]);
      const stored = studio.store.surveys.get(record.Id as string)!;
      expect(record).toEqual({
        Name: "My survey",
        IsArchived: false,
        UserId: ANN,
        CreatorId: ANN,
        PostId: stored.postId,
        ResultId: stored.resultId,
        PublishId: null,
        IsPublished: true,
        UseCookies: false,
        UpdatedOn: "2026-11-19T10:00:00.127",
        CreatedAt: "2026-11-19T10:00:00.127",
        AllowAccessResult: false,
        StoreIPAddress: false,
        Theme: null,
        Json: null,
        Id: stored.id,
      });
      expect(stored.projectId).toBeNull();
      expect(JSON.parse(studio.requests[0]!.body.toString())).toEqual({
        name: "My survey",
        definition: {},
      });
    });

    it("takes the name from the form before the query", async () => {
      const answer = await call("POST", "create", "name=query", {
        headers: FORM,
        body: "Name=form",
      });
      expect((JSON.parse(answer.body.toString()) as { Name: string }).Name).toBe("form");
    });

    it("creates in a project the caller belongs to, and in Personal for any other ownerId", async () => {
      const inProject = await call("POST", "create", `name=P&ownerId=${PROJECT}`);
      const record = JSON.parse(inProject.body.toString()) as Record<string, string>;
      expect(record.UserId).toBe(PROJECT);
      expect(studio.store.surveys.get(record.Id!)!.projectId).toBe(PROJECT);

      for (const ownerId of [STRANGERS, ANN]) {
        const answer = await call("POST", "create", `name=X&ownerId=${ownerId}`);
        const personal = JSON.parse(answer.body.toString()) as Record<string, string>;
        expect(personal.UserId).toBe(ANN);
        expect(studio.store.surveys.get(personal.Id!)!.projectId).toBeNull();
      }
    });

    it("lets Studio name a survey created without a name", async () => {
      const answer = await call("POST", "create");
      expect((JSON.parse(answer.body.toString()) as { Name: string }).Name).toBe("New Survey 1");
      expect(JSON.parse(studio.requests[0]!.body.toString())).toEqual({ definition: {} });
    });

    it("answers a name Studio refuses with an empty 400", async () => {
      expectEmpty(await call("POST", "create", `name=${"x".repeat(201)}`), 400);
      expect(studio.store.surveys.size).toBe(0);
    });

    it("answers a missing key with an empty 401 before reading the body", async () => {
      const { data } = await sendRaw(
        bridge.url,
        "POST /private/Surveys/create HTTP/1.1\r\nHost: x\r\nConnection: close\r\n" +
          "Content-Type: application/x-www-form-urlencoded\r\nContent-Length: 30000001\r\n\r\nname=",
      );
      expect(data.split("\r\n")[0]).toBe("HTTP/1.1 401 Unauthorized");
      expect(studio.requests).toEqual([]);
    });
  });

  describe("archive, restore and delete", () => {
    it("archives and restores, with the id from the form, the route or the query", async () => {
      const survey = add();
      expectEmpty(await call("PUT", `archive/${survey.id}`), 200);
      expect(survey.archived).toBe(true);
      expectEmpty(await call("PUT", "restore", `id=${survey.id}`), 200);
      expect(survey.archived).toBe(false);
      // The form beats the route, which beats the query.
      expectEmpty(
        await call("PUT", `archive/${UNKNOWN}`, `id=${UNKNOWN}`, {
          headers: FORM,
          body: `ID=${survey.id}`,
        }),
        200,
      );
      expect(survey.archived).toBe(true);
      expectEmpty(await call("PUT", `Restore/${survey.id}/`, `id=${UNKNOWN}`), 200);
      expect(survey.archived).toBe(false);
    });

    it("answers an unknown, malformed or forbidden survey with the old 400", async () => {
      const projects = add({ projectId: PROJECT });
      expectJson(await call("PUT", `archive/${UNKNOWN}`), 400, modify(UNKNOWN));
      expectJson(await call("PUT", "archive/abc"), 400, modify(ZERO));
      expectJson(await call("PUT", "restore"), 400, modify(ZERO));
      expectJson(
        await call("PUT", `archive/${projects.id}`, "", { key: BOB_KEY }),
        400,
        modify(projects.id),
      );
      expect(projects.archived).toBe(false);
    });

    it("deletes an archived survey with one call", async () => {
      const survey = add({ archived: true });
      expectEmpty(await call("DELETE", `delete/${survey.id}`), 200);
      expect(studio.store.surveys.has(survey.id)).toBe(false);
      expect(studioCalls()).toEqual([`DELETE /api/v1/surveys/${survey.id}`]);
    });

    it("archives an active survey and then deletes it (Review Focus 3)", async () => {
      const survey = add({ projectId: PROJECT, creatorId: BOB });
      expectEmpty(await call("DELETE", "delete", `id=${survey.id}`), 200);
      expect(studio.store.surveys.has(survey.id)).toBe(false);
      expect(studioCalls()).toEqual([
        `DELETE /api/v1/surveys/${survey.id}`,
        `PATCH /api/v1/surveys/${survey.id}`,
        `DELETE /api/v1/surveys/${survey.id}`,
      ]);
      expect(JSON.parse(studio.requests[1]!.body.toString())).toEqual({ archived: true });
    });

    it("refuses a member who is neither admin nor creator, leaving the survey intact (Review Focus 3)", async () => {
      const survey = add({ projectId: PROJECT, creatorId: ANN });
      expectJson(
        await call("DELETE", `delete/${survey.id}`, "", { key: BOB_KEY }),
        400,
        modify(survey.id),
      );
      expect(studio.store.surveys.get(survey.id)?.archived).toBe(false);
      expectJson(await call("DELETE", `delete/${UNKNOWN}`), 400, modify(UNKNOWN));
    });
  });

  describe("changeName", () => {
    it("renames the survey", async () => {
      const survey = add({ name: "Old" });
      expectEmpty(await call("PUT", `changeName/${survey.id}`, "name=New%20name"), 200);
      expect(survey.name).toBe("New name");
    });

    it("keeps the name when none is given, but the survey moves up as the old API's did", async () => {
      const survey = add({ name: "Old", updatedAt: "2026-01-01T00:00:00.000Z" });
      expectEmpty(await call("PUT", `changeName/${survey.id}`, "name="), 200);
      expect(survey.name).toBe("Old");
      expect(survey.updatedAt).toBe("2026-11-19T10:00:00.127Z");
      expect(studioCalls()).toEqual([
        `GET /api/v1/surveys/${survey.id}`,
        `PATCH /api/v1/surveys/${survey.id}`,
      ]);
    });

    it("answers an unknown or forbidden survey with the old 400, and a name Studio refuses with an empty 400", async () => {
      const projects = add({ projectId: PROJECT });
      expectJson(await call("PUT", `changeName/${UNKNOWN}`, "name=x"), 400, modify(UNKNOWN));
      expectJson(await call("PUT", `changeName/${UNKNOWN}`), 400, modify(UNKNOWN));
      expectJson(
        await call("PUT", `changeName/${projects.id}`, "", { key: BOB_KEY }),
        400,
        modify(projects.id),
      );
      expectEmpty(await call("PUT", `changeName/${projects.id}`, `name=${"x".repeat(201)}`), 400);
    });
  });

  describe("publish, unPublish and getIsPublished", () => {
    it("publishes and unpublishes", async () => {
      const survey = add({ published: false });
      expectEmpty(await call("PUT", `publish/${survey.id}`), 200);
      expect(survey.published).toBe(true);
      expectEmpty(await call("PUT", `unpublish/${survey.id}`), 200);
      expect(survey.published).toBe(false);
      expectJson(await call("PUT", `publish/${UNKNOWN}`), 400, modify(UNKNOWN));
      expectJson(await call("PUT", `unPublish/${UNKNOWN}`), 400, modify(UNKNOWN));
    });

    it("answers false after publish unless the survey has an old publish ID", async () => {
      const plain = add({ published: false });
      const old = add({ published: false, legacyPublishId: PUBLISH_ID });
      await call("PUT", `publish/${plain.id}`);
      await call("PUT", `publish/${old.id}`);
      expectJson(await call("GET", `getIsPublished/${plain.id}`), 200, "false");
      expectJson(await call("GET", "getIsPublished", `id=${old.id}`), 200, "true");
      await call("PUT", `unPublish/${old.id}`);
      expectJson(await call("GET", `getIsPublished/${old.id}`), 200, "false");
      expectJson(await call("GET", `getIsPublished/${UNKNOWN}`), 400, getInfo(UNKNOWN));
    });
  });

  describe("publishVersion and changeVersionTitle", () => {
    it("finds the survey by its publish ID and answers as the old API", async () => {
      const survey = add({ legacyPublishId: PUBLISH_ID, updatedAt: "2026-01-01T00:00:00.000Z" });
      expectJson(
        await call("PUT", "publishVersion", `versionId=${PUBLISH_ID.toUpperCase()}`),
        200,
        JSON.stringify(PUBLISH_ID),
      );
      // Only the time the survey changed moves, as the old rewrite of the same publish ID.
      expect(studioCalls().map((c) => c.split("?")[0])).toEqual([
        "GET /api/v1/surveys",
        `PATCH /api/v1/surveys/${survey.id}`,
      ]);
      expect(JSON.parse(studio.requests[1]!.body.toString())).toEqual({ archived: false });
      expect(survey.updatedAt).toBe("2026-11-19T10:00:00.127Z");
      expect([survey.archived, survey.legacyPublishId]).toEqual([false, PUBLISH_ID]);
      expectJson(
        await call("PUT", "changeVersionTitle", `versionId=${PUBLISH_ID}&title=v2`),
        200,
        "true",
      );
      const query = new URL(studio.requests[0]!.url, "http://x").searchParams;
      expect(query.get("legacyPublishId")).toBe(PUBLISH_ID);
    });

    it("answers an unknown version: publishVersion an empty 400, changeVersionTitle the old text", async () => {
      expectEmpty(await call("PUT", "publishVersion", `versionId=${UNKNOWN}`), 400);
      expectEmpty(await call("PUT", "publishVersion"), 400);
      expectJson(
        await call("PUT", "changeVersionTitle", `versionId=${UNKNOWN}`),
        400,
        JSON.stringify(`You are not authorized to modify the survey version ${UNKNOWN}.`),
      );
    });

    it("refuses a caller who may not change the survey", async () => {
      add({ projectId: PROJECT, creatorId: ANN, legacyPublishId: PUBLISH_ID });
      expectJson(
        await call("PUT", "publishVersion", `versionId=${PUBLISH_ID}`, { key: BOB_KEY }),
        400,
        JSON.stringify(`You are not authorized to publish the survey version ${PUBLISH_ID}.`),
      );
      expectJson(
        await call("PUT", "changeVersionTitle", `versionId=${PUBLISH_ID}`, { key: BOB_KEY }),
        400,
        JSON.stringify(`You are not authorized to modify the survey version ${PUBLISH_ID}.`),
      );
    });
  });

  describe("the settings", () => {
    it("setUseCookies stores the value and always answers true", async () => {
      const survey = add();
      expectJson(await call("PUT", `setUseCookies/${survey.id}`, "useCookies=TRUE"), 200, "true");
      expect(survey.useCookies).toBe(true);
      expectJson(await call("PUT", `setUseCookies/${survey.id}`, "useCookies=1"), 200, "true");
      expect(survey.useCookies).toBe(false);
      expectJson(
        await call("PUT", `setUseCookies/${survey.id}`, "", {
          headers: FORM,
          body: "useCookies=true",
        }),
        200,
        "true",
      );
      expect(survey.useCookies).toBe(true);
      expectJson(await call("PUT", `setUseCookies/${UNKNOWN}`), 400, modify(UNKNOWN));
    });

    it("makeResultPublic and storeIPAddressInResult answer the stored value", async () => {
      const survey = add();
      expectJson(
        await call("PUT", `makeResultPublic/${survey.id}`, "makeResultPublic=true"),
        200,
        "true",
      );
      expect(survey.publicResults).toBe(true);
      expectJson(await call("PUT", "makeResultPublic", `id=${survey.id}`), 200, "false");
      expect(survey.publicResults).toBe(false);
      expectJson(
        await call("PUT", `storeIPAddressInResult/${survey.id}`, "storeIPAddress=true"),
        200,
        "true",
      );
      expect(survey.storeRespondentIp).toBe(true);
      expectJson(await call("PUT", `makeResultPublic/${UNKNOWN}`), 400, modify(UNKNOWN));
      expectJson(await call("PUT", `storeIPAddressInResult/${UNKNOWN}`), 400, modify(UNKNOWN));
    });

    it("getIsResultPublic answers the setting", async () => {
      const survey = add({ publicResults: true });
      expectJson(await call("GET", `getIsResultPublic/${survey.id}`), 200, "true");
      expectJson(await call("GET", `getIsResultPublic/${UNKNOWN}`), 400, getInfo(UNKNOWN));
      expectEmpty(await call("GET", `getIsResultPublic/${survey.id}`, "", { key: "" }), 401);
    });
  });

  describe("clone", () => {
    it("POST clone copies the survey beside its source and answers an empty 200", async () => {
      const source = add({ name: "Feedback", projectId: PROJECT, theme: { themeName: "x" } });
      expectEmpty(await call("POST", "clone", `surveyId=${source.id}`), 200);
      const copies = [...studio.store.surveys.values()].filter((s) => s.id !== source.id);
      expect(copies.map((s) => [s.name, s.projectId])).toEqual([["Copy of Feedback", PROJECT]]);
      expect(studio.requests[0]!.body.toString()).toBe("{}");
    });

    it("POST clone answers a missing or refused key with an empty 401, an unknown survey with the old 400", async () => {
      const source = add();
      expectEmpty(await call("POST", "clone", `surveyId=${source.id}`, { key: "" }), 401);
      expectEmpty(await call("POST", "clone", `surveyId=${source.id}`, { key: "nope" }), 401);
      expectJson(await call("POST", "clone", `surveyId=${UNKNOWN}`), 400, modify(UNKNOWN));
      expectJson(await call("POST", "clone", `id=${source.id}`), 400, modify(ZERO));
    });

    it("PUT clone copies by id and answers a bad key with the text", async () => {
      const source = add({ name: "Feedback" });
      expectEmpty(await call("PUT", `clone/${source.id}`), 200);
      expect(studio.store.surveys.size).toBe(2);
      expectText(
        await call("PUT", `clone/${source.id}`, "", { key: "<b>" }),
        "The accessKey '&lt;b&gt;' is incorrect.",
      );
      expectText(
        await call("PUT", `clone/${source.id}`, "", { key: "" }),
        "The accessKey '' is incorrect.",
      );
      expectJson(await call("PUT", "clone", `id=${UNKNOWN}`), 400, modify(UNKNOWN));
    });

    it("PUT clone binds the key from a form body before the query", async () => {
      const source = add({ name: "Feedback" });
      const form: [string, string][] = [["Content-Type", "application/x-www-form-urlencoded"]];
      expectEmpty(
        await call("PUT", `clone/${source.id}`, "", {
          key: "",
          headers: form,
          body: `ACCESSKEY=${KEY}`,
        }),
        200,
      );
      expectEmpty(
        await call("PUT", `clone/${source.id}`, "", {
          key: "wrong",
          headers: form,
          body: `accessKey=${KEY}`,
        }),
        200,
      );
      expect(studio.store.surveys.size).toBe(3);
      expect(studio.requests.every((r) => r.headers.authorization === `Bearer ${KEY}`)).toBe(true);
      expectText(
        await call("PUT", `clone/${source.id}`, "", {
          headers: form,
          body: "accessKey=%3Cb%3E",
        }),
        "The accessKey '&lt;b&gt;' is incorrect.",
      );
      expect(studio.store.surveys.size).toBe(3);
    });
  });

  describe("changeOrganization", () => {
    const denied = "Something going wrong. Access denied.";

    it("moves a project survey to Personal for the caller's own id", async () => {
      const survey = add({ projectId: PROJECT, creatorId: BOB });
      expectEmpty(
        await call("PUT", `changeOrganization/${survey.id}`, `organizationId=${ANN.toUpperCase()}`),
        200,
      );
      expect(survey.projectId).toBeNull();
      expect(survey.ownerUserId).toBe(ANN);
      expect(JSON.parse(studio.requests.at(-1)!.body.toString())).toEqual({ projectId: null });
    });

    it("moves a survey to a project the caller belongs to", async () => {
      const survey = add();
      expectEmpty(
        await call("PUT", "changeOrganization", `id=${survey.id}&organizationId=${PROJECT}`),
        200,
      );
      expect(survey.projectId).toBe(PROJECT);
    });

    it("answers the old text for any other id, a missing one, or a survey the caller may not move", async () => {
      const survey = add();
      const bobs = add({ projectId: PROJECT, creatorId: ANN });
      expectText(
        await call("PUT", `changeOrganization/${survey.id}`, `organizationId=${STRANGERS}`),
        denied,
      );
      expectText(await call("PUT", `changeOrganization/${survey.id}`), denied);
      expectText(
        await call("PUT", `changeOrganization/${UNKNOWN}`, `organizationId=${PROJECT}`),
        denied,
      );
      expectText(
        await call("PUT", `changeOrganization/${bobs.id}`, `organizationId=${BOB}`, {
          key: BOB_KEY,
        }),
        denied,
      );
      expect(survey.projectId).toBeNull();
      expect(bobs.projectId).toBe(PROJECT);
    });

    it("answers a refused key with an empty 401", async () => {
      expectEmpty(await call("PUT", `changeOrganization/${UNKNOWN}`, "", { key: "nope" }), 401);
    });
  });
});
