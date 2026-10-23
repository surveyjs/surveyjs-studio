import { describe, expect, it } from "vitest";
import { historyProblem, originAndPath, trimHeading } from "./history-report.js";

describe("history report", () => {
  it("keeps only the origin and path", () => {
    expect(originAndPath("https://surveyjs.io/service/history/abc?key=secret#frag")).toBe(
      "https://surveyjs.io/service/history/abc",
    );
    expect(originAndPath("not a url")).toBe("(unreadable address)");
  });

  it("flattens and truncates the heading to 120 characters", () => {
    expect(trimHeading("  Survey \n  history ")).toBe("Survey history");
    expect(trimHeading("x".repeat(300))).toHaveLength(120);
  });

  it("explains a short history without query, fragment or keys", () => {
    const message = historyProblem(
      {
        surveyId: "86ece785",
        finalUrl: "https://surveyjs.io/service/mysurveys/personal?accessKey=SECRET#x",
        status: 200,
        heading: "My Surveys",
        entries: 0,
        screenshot: "e2e/visual/.state/history-chromium.png",
      },
      2,
      "fix it",
    );
    expect(message).toBe(
      'History: 0 entries, expected at least 2 (survey id 86ece785, page https://surveyjs.io/service/mysurveys/personal, status 200, h1 "My Surveys", screenshot e2e/visual/.state/history-chromium.png): fix it',
    );
    expect(message).not.toMatch(/SECRET|\?|#x/);
  });

  it("names a missing response", () => {
    const message = historyProblem(
      {
        surveyId: "a",
        finalUrl: "https://s.io/p",
        status: null,
        heading: "",
        entries: 1,
        screenshot: "s.png",
      },
      2,
      "f",
    );
    expect(message).toContain("status none");
  });
});
