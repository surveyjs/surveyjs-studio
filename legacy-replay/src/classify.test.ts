import { describe, expect, it } from "vitest";
import { ACTIONS } from "../../bridge/src/mapping.js";
import { PREFIXES } from "../../bridge/src/routes.js";
import { classify, strictestLimit } from "./classify.js";

const ID = "5af48e08-a0a5-44a5-83f4-1c90e8e98de1";
const row = (method: string, path: string) => ({ method, path });

describe("classify", () => {
  it("skips a post as a write", () => {
    expect(classify(row("POST", "/public/Survey/post"))).toEqual({ kind: "skip", reason: "write" });
  });

  it("replays getSurveyResults, a keyed read Studio does not limit per address", () => {
    expect(classify(row("GET", `/private/v1/Surveys/getSurveyResults/${ID}`))).toEqual({
      kind: "replay",
      action: "getSurveyResults",
      limit: null,
    });
  });

  it("replays the public results under the public limit, one question's summary under summary", () => {
    expect(classify(row("get", `/Private/Surveys/getSurveyPublicResults/${ID}/`))).toEqual({
      kind: "replay",
      action: "getSurveyPublicResults",
      limit: "public",
    });
    expect(classify(row("GET", "/public/Survey/getResult"))).toEqual({
      kind: "replay",
      action: "getResult",
      limit: "summary",
    });
  });

  it("takes the strictest limit of the action's operations", () => {
    // getPublicLayout and getPublicResults are both public; image reads files.
    expect(classify(row("GET", "/private/Surveys/getResultPublicColumns"))).toMatchObject({
      limit: "public",
    });
    expect(classify(row("GET", "/public/Survey/image"))).toMatchObject({ limit: "file" });
  });

  it("knows the strictest class: summary, then public, then file", () => {
    expect(strictestLimit(["downloadFile", "getPublicResults", "getQuestionSummary"])).toBe(
      "summary",
    );
    expect(strictestLimit(["getSurvey", "downloadFile", "getPublicResults"])).toBe("public");
    expect(strictestLimit(["getSurvey", "downloadFile"])).toBe("file");
    expect(strictestLimit(["getSurvey", "listResults"])).toBeNull();
    expect(strictestLimit([])).toBeNull();
  });

  it("skips a path the bridge forwards", () => {
    expect(classify(row("GET", "/elsewhere/page"))).toEqual({ kind: "skip", reason: "forwarded" });
    expect(classify(row("GET", "@elsewhere/public/Survey/getSurvey"))).toEqual({
      kind: "skip",
      reason: "forwarded",
    });
  });

  it("skips a GET that writes (generateAccessKey) and the root path", () => {
    expect(classify(row("GET", "/private/Surveys/generateAccessKey"))).toEqual({
      kind: "skip",
      reason: "write",
    });
    expect(classify(row("GET", "/private/Surveys"))).toEqual({ kind: "skip", reason: "write" });
  });

  it("replays only GET: HEAD, OPTIONS and every other method on a read are writes", () => {
    for (const method of ["HEAD", "OPTIONS", "POST", "PUT", "DELETE", "PATCH"]) {
      expect(classify(row(method, "/public/Survey/getSurvey")), method).toEqual({
        kind: "skip",
        reason: "write",
      });
    }
  });

  it("skips a method no router knows", () => {
    for (const method of ["PROPFIND", "", "G ET"]) {
      expect(classify(row(method, "/public/Survey/getSurvey")), method).toEqual({
        kind: "skip",
        reason: "unknown-method",
      });
    }
  });

  it("replays exactly the GET entries marked read, under both prefixes", () => {
    for (const entry of ACTIONS) {
      for (const prefix of PREFIXES[entry.controller]) {
        for (const path of entry.paths) {
          const url = path === "" ? prefix : `${prefix}/${path.replace(":id", ID)}`;
          for (const method of entry.methods) {
            const result = classify(row(method, url));
            const replayed = method === "GET" && entry.effect === "read";
            expect(result.kind, `${method} ${url}`).toBe(replayed ? "replay" : "skip");
            if (result.kind === "replay") expect(result.action).toBe(entry.action);
          }
        }
      }
    }
  });
});
