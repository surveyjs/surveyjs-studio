import { describe, expect, it } from "vitest";
import type { SurveyRecord } from "../domain/types.js";
import { limitCookieOf, publishedDefinition } from "./one-response.js";

const SURVEY_ID = "cccccccc-0000-4000-8000-00000000000a";

function survey(useCookies: boolean): SurveyRecord {
  return {
    id: SURVEY_ID,
    name: "Poll",
    owner: { kind: "personal", userId: "aaaaaaaa-0000-4000-8000-000000000001" },
    creatorId: null,
    postId: "dddddddd-0000-4000-8000-000000000001",
    resultId: "eeeeeeee-0000-4000-8000-000000000001",
    published: true,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    settings: { publicResults: false, storeRespondentIp: false, useCookies },
  };
}

describe("publishedDefinition", () => {
  it("names the cookie after the survey when the setting is on and the definition has none", () => {
    const definition = { title: "Poll" };
    expect(publishedDefinition(survey(true), definition)).toStrictEqual({
      title: "Poll",
      cookieName: SURVEY_ID,
    });
    expect(definition).toStrictEqual({ title: "Poll" });
  });

  it("keeps a cookie name the definition has", () => {
    expect(publishedDefinition(survey(true), { cookieName: "x" })).toStrictEqual({
      cookieName: "x",
    });
  });

  it("counts an empty cookie name as none", () => {
    expect(publishedDefinition(survey(true), { cookieName: "" })).toStrictEqual({
      cookieName: SURVEY_ID,
    });
  });

  it("leaves the definition as it is when the setting is off", () => {
    expect(publishedDefinition(survey(false), { title: "Poll" })).toStrictEqual({ title: "Poll" });
    expect(publishedDefinition(survey(false), { cookieName: "" })).toStrictEqual({
      cookieName: "",
    });
  });
});

describe("limitCookieOf", () => {
  it("returns a non-empty string cookie name", () => {
    expect(limitCookieOf({ cookieName: "x" })).toBe("x");
  });

  it("returns null for an empty, missing or non-string name", () => {
    expect(limitCookieOf({ cookieName: "" })).toBeNull();
    expect(limitCookieOf({})).toBeNull();
    expect(limitCookieOf({ cookieName: 5 })).toBeNull();
  });
});
