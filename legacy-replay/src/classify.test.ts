import { describe, expect, it } from "vitest";
import { ACTIONS } from "../../bridge/src/mapping.js";
import { PREFIXES } from "../../bridge/src/routes.js";
import { classify, requestUrl, strictestLimit } from "./classify.js";

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

  it("finds the URL fetch sends, on the base origin only", () => {
    expect(requestUrl("https://old.example", { path: "/a/b/../c", query: "x=1" })?.href).toBe(
      "https://old.example/a/c?x=1",
    );
    expect(requestUrl("https://old.example", { path: "//elsewhere.example/a", query: "" })).toBe(
      undefined,
    );
    expect(requestUrl("https://old.example", { path: "\\\\elsewhere.example/a", query: "" })).toBe(
      undefined,
    );
  });

  it("skips a path the bridge forwards", () => {
    expect(classify(row("GET", "/elsewhere/page"))).toEqual({ kind: "skip", reason: "forwarded" });
    expect(classify(row("GET", "@elsewhere/public/Survey/getSurvey"))).toEqual({
      kind: "skip",
      reason: "unsafe-path",
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

  it("skips a path outside the allowlist as unsafe, before anything else", () => {
    const keyed = "/private/Surveys/getSurveyResults";
    for (const path of [
      `${keyed}/..%2FgenerateAccessKey`,
      `${keyed}/..%2fgenerateAccessKey`,
      `${keyed}/..%5CgenerateAccessKey`,
      `${keyed}/%2E%2E%2FgenerateAccessKey`,
      `${keyed}/..\\generateAccessKey`,
      `${keyed}/%2E%2E\\publish`,
      `${keyed}/..`,
      `${keyed}/.`,
      `${keyed}/x#y`,
      `${keyed}/x?y`,
      `${keyed}/x;y`,
      `${keyed}/x y`,
      `${keyed}/x\ny`,
      `${keyed}//`,
      "/private//Surveys/getActive",
      "private/Surveys/getActive",
      "",
    ]) {
      for (const method of ["GET", "POST", "BREW"]) {
        expect(classify(row(method, path)), `${method} ${path}`).toEqual({
          kind: "skip",
          reason: "unsafe-path",
        });
      }
    }
    for (const query of ["a=1#b", "a=\u0000", "a=\u007f", "a=\r\n"]) {
      expect(classify({ method: "GET", path: keyed, query }), query).toEqual({
        kind: "skip",
        reason: "unsafe-path",
      });
    }
  });

  it("replays GUIDs with or without dashes or braces, and one trailing slash", () => {
    for (const id of [ID, `{${ID}}`, ID.replaceAll("-", ""), `${ID}/`]) {
      const path = `/private/Surveys/getSurveyResults/${id}`;
      expect(classify({ method: "GET", path, query: "accessKey=a%2Fb&x=y z" }), id).toEqual({
        kind: "replay",
        action: "getSurveyResults",
        limit: null,
      });
    }
    expect(classify(row("GET", "/public/Survey/getSurvey/"))).toMatchObject({ kind: "replay" });
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
