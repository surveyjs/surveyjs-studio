import { describe, expect, it } from "vitest";
import {
  limitedPublishedSurvey,
  publishedSurveyHandler,
  samplePublishedSurvey,
} from "../test/public-handlers";
import { server } from "../test/server";
import type { ClientIds } from "./clientId";
import { loadRunSurvey } from "./load";

const surveyId = samplePublishedSurvey.id;

/** Client ids with a fixed stored value; `ensure` must not be needed while loading. */
const clientIdsWith = (stored: string | null): ClientIds => ({
  stored: () => Promise.resolve(stored),
  ensure: () => Promise.reject(new Error("loading must not create a client id")),
});

/** Serves `survey` and records the `clientId` of each request (null when absent). */
function serve(survey: typeof samplePublishedSurvey, completedFor?: string) {
  const clientIds: (string | null)[] = [];
  server.use(
    publishedSurveyHandler(survey, {
      completedFor,
      onRequest: (url) => clientIds.push(url.searchParams.get("clientId")),
    }),
  );
  return clientIds;
}

describe("loadRunSurvey", () => {
  it("reads once without a client id when the survey has no limit", async () => {
    const sent = serve(samplePublishedSurvey, "client-1");

    await expect(loadRunSurvey(surveyId, clientIdsWith("client-1"))).resolves.toEqual({
      survey: samplePublishedSurvey,
      limitCookie: null,
      completed: false,
    });
    expect(sent).toEqual([null]);
  });

  it("reads once when the limit is on and the browser has no client id", async () => {
    const sent = serve(limitedPublishedSurvey);

    await expect(loadRunSurvey(surveyId, clientIdsWith(null))).resolves.toEqual({
      survey: limitedPublishedSurvey,
      limitCookie: surveyId,
      completed: false,
    });
    expect(sent).toEqual([null]);
  });

  it.each([
    ["has completed", "client-1", true],
    ["has not completed", "someone-else", false],
  ])(
    "asks again with the stored client id when the limit is on: the client %s",
    async (_, completedFor, completed) => {
      const sent = serve(limitedPublishedSurvey, completedFor);

      await expect(loadRunSurvey(surveyId, clientIdsWith("client-1"))).resolves.toEqual({
        survey: limitedPublishedSurvey,
        limitCookie: surveyId,
        completed,
      });
      expect(sent).toEqual([null, "client-1"]);
    },
  );
});
