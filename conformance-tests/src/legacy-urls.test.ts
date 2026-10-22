import { describe, expect, it } from "vitest";
import { baseUrl, codeOf } from "./harness.js";

// R22: surveyjs.io's old addresses are not this app's. The site redirects its own links; the
// server knows none of them and never redirects one. The binding part is a 404 without a
// `Location`. The body is a `not-found` Problem, or, when the server also serves the web app
// (WEB_ROOT, design D2), the app's HTML page, which shows its not-found page.
const CAMPAIGN_SURVEY_ID = "22222222-0000-4000-8000-a00000000004";
const FEEDBACK_SURVEY_ID = "22222222-0000-4000-8000-a00000000001";

describe(`surveyjs.io addresses on the server at ${baseUrl}`, () => {
  it.each([[`/published?id=${CAMPAIGN_SURVEY_ID}`], [`/Service/EditSurvey/${FEEDBACK_SURVEY_ID}`]])(
    "%s is not found, without a redirect",
    async (path) => {
      const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });

      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.startsWith("text/html")) {
        expect(await response.text()).toMatch(/^<!doctype html>/i);
      } else {
        expect(contentType).toMatch(/^application\/problem\+json/);
        expect(await codeOf(response)).toBe("not-found");
      }
    },
  );
});
