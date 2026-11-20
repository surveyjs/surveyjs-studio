import { readFile } from "node:fs/promises";
import { openapiPath } from "@surveyjs-studio/contract";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ACTIONS, type ActionEntry } from "./mapping.js";
import { send, startBridge, startStub, type RunningBridge, type Stub } from "./testing/http.js";
import { startFakeStudio, type FakeStudio } from "./testing/studio-stub.js";

const PREFIXES = {
  public: ["/public/Survey", "/public/v1/Survey"],
  private: ["/private/Surveys", "/private/v1/Surveys"],
} as const;

const SOME_ID = "5af48e08-a0a5-44a5-83f4-1c90e8e98de1";

/** Every URL path of an entry: both prefixes, each of its paths, `:id` filled in. */
function urlsOf(entry: ActionEntry): string[] {
  return PREFIXES[entry.controller].flatMap((prefix) =>
    entry.paths.map((path) =>
      path === "" ? prefix : `${prefix}/${path.replace(/:[A-Za-z]+/g, SOME_ID)}`,
    ),
  );
}

describe("ACTIONS", () => {
  it("names only operations of Studio's contract", async () => {
    const text = await readFile(openapiPath, "utf8");
    const operations = new Set([...text.matchAll(/^\s+operationId:\s*(\S+)/gm)].map((m) => m[1]));
    expect(operations.size).toBeGreaterThan(0);
    for (const entry of ACTIONS) {
      for (const name of entry.studio) {
        expect(operations, `${entry.action}: ${name}`).toContain(name);
      }
    }
  });

  it("gives no method and path to two entries", () => {
    const seen = new Map<string, string>();
    for (const entry of ACTIONS) {
      for (const url of urlsOf(entry)) {
        for (const method of entry.methods) {
          // The router matches any letter case; a parameter matches whatever its name.
          const route = `${method} ${url.toLowerCase()}`;
          expect(seen.get(route), route).toBeUndefined();
          seen.set(route, entry.action);
        }
      }
    }
  });

  it("holds Step 5's actions and this step's own", () => {
    const names = new Set(ACTIONS.map((entry) => entry.action));
    for (const name of [
      "getSurvey",
      "getSurveyAndIsCompleted",
      "isCompleted",
      "post",
      "upload",
      "getResult",
      "getSurveyPublicResults",
      "image",
      "file",
      "files",
      "generateAccessKey",
      "setGenerationJSONType",
      "getSurveyInfo",
      "getActive",
      "getArchive",
      "create",
      "archive",
      "restore",
      "delete",
      "changeName",
      "getIsPublished",
      "publishVersion",
      "publish",
      "unPublish",
      "setUseCookies",
      "changeVersionTitle",
      "getIsResultPublic",
      "makeResultPublic",
      "storeIPAddressInResult",
      "clone",
      "changeOrganization",
      "deleteResult",
      "deleteAllResults",
      "getSurveyResults",
      "getSurveyDemoResults",
      "exportSurveyResults",
    ]) {
      expect(names, name).toContain(name);
    }
  });
});

describe("the router built from ACTIONS", () => {
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
  });

  it("answers every route of every entry itself, under both prefixes", async () => {
    for (const entry of ACTIONS) {
      for (const url of urlsOf(entry)) {
        for (const method of entry.methods) {
          await send(`${bridge.url}${url}`, { method });
          expect(legacy.requests, `${method} ${url}`).toEqual([]);
        }
      }
    }
  });

  it("answers an entry's bad-key answer without a key or with an empty one, and asks Studio nothing", async () => {
    const keyed = ACTIONS.filter((entry) => entry.key !== "none");
    expect(keyed.length).toBeGreaterThan(0);
    for (const entry of keyed) {
      for (const url of urlsOf(entry)) {
        for (const method of entry.methods) {
          for (const query of ["", "?accessKey=", "?ACCESSKEY=&x=1"]) {
            const where = `${method} ${url}${query}`;
            const answer = await send(`${bridge.url}${url}${query}`, { method });
            if (entry.key === "text") {
              expect(answer.status, where).toBe(200);
              expect(answer.headers["content-type"], where).toBe("text/html; charset=utf-8");
              expect(answer.body.toString(), where).toBe("The accessKey '' is incorrect.");
            } else {
              expect(answer.status, where).toBe(401);
              expect(answer.body.length, where).toBe(0);
              expect(answer.headers.location, where).toBeUndefined();
            }
          }
        }
      }
    }
    expect(studio.requests).toEqual([]);
    expect(legacy.requests).toEqual([]);
  });
});
