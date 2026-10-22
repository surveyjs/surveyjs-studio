import { describe, expect, it } from "vitest";
import { baseUrl, codeOf } from "./harness.js";

// R22: surveyjs.io's old addresses are not this app's. The site redirects its own links; the
// server knows none of them and never redirects one. (The web app shows its not-found page.)
const CAMPAIGN_SURVEY_ID = "22222222-0000-4000-8000-a00000000004";
const FEEDBACK_SURVEY_ID = "22222222-0000-4000-8000-a00000000001";

describe(`surveyjs.io addresses on the server at ${baseUrl}`, () => {
  it.each([[`/published?id=${CAMPAIGN_SURVEY_ID}`], [`/Service/EditSurvey/${FEEDBACK_SURVEY_ID}`]])(
    "%s is not found, without a redirect",
    async (path) => {
      const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });

      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toMatch(/^application\/problem\+json/);
      expect(response.headers.get("location")).toBeNull();
      expect(await codeOf(response)).toBe("not-found");
    },
  );
});
