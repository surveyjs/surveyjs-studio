import { describe, expect, it } from "vitest";
import { completedBeforeCookie, runCookieName } from "./cookie";

const SURVEY_ID = "11111111-0000-4000-8000-000000000001";
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

describe("runCookieName", () => {
  it.each([SURVEY_ID, "my-survey_1", "a.b!c#d$e%f&g'h*i+j^k`l|m~n"])(
    "keeps the token %j",
    (name) => {
      expect(runCookieName(name, SURVEY_ID)).toBe(name);
    },
  );

  it.each([
    ["a b", "a%20b"],
    ["a;b", "a%3Bb"],
    ["a=b", "a%3Db"],
    ["a,b", "a%2Cb"],
    ["a(b)", "a%28b%29"],
    ["msid_csrf=x; path=/; a", "msid_csrf%3Dx%3B%20path%3D%2F%3B%20a"],
    ["a; domain=example.com", "a%3B%20domain%3Dexample.com"],
    ["опрос", "%D0%BE%D0%BF%D1%80%D0%BE%D1%81"],
  ])("maps %j to the token %j", (name, expected) => {
    const mapped = runCookieName(name, SURVEY_ID);

    expect(mapped).toBe(expected);
    expect(mapped).toMatch(TOKEN);
  });

  it("uses the survey id for a name that cannot be encoded", () => {
    expect(runCookieName("a\uD800", SURVEY_ID)).toBe(SURVEY_ID);
  });
});

describe("completedBeforeCookie", () => {
  it("names the cookie the Form Library reads, for the run pages only, without expiry", () => {
    expect(completedBeforeCookie(SURVEY_ID)).toBe(
      `${SURVEY_ID}=true; path=/s; expires=Fri, 31 Dec 9999 23:59:59 GMT`,
    );
  });

  it("is scoped to the run pages under the base path of a sandbox on a sub-path", () => {
    expect(completedBeforeCookie(SURVEY_ID, "/studio")).toBe(
      `${SURVEY_ID}=true; path=/studio/s; expires=Fri, 31 Dec 9999 23:59:59 GMT`,
    );
  });

  it("writes a mapped name, which carries no attributes", () => {
    const cookie = completedBeforeCookie(runCookieName("msid_csrf=x; path=/; a", SURVEY_ID));

    expect(cookie).toBe(
      "msid_csrf%3Dx%3B%20path%3D%2F%3B%20a=true; path=/s; expires=Fri, 31 Dec 9999 23:59:59 GMT",
    );
  });

  it.each(["a;b", "a b", "a=b", "a,b", "a(b", "опрос", ""])("refuses the name %j", (name) => {
    expect(completedBeforeCookie(name)).toBeNull();
  });
});
