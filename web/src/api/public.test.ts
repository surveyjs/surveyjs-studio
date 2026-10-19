import { HttpResponse, http as mswHttp } from "msw";
import { describe, expect, it } from "vitest";
import type { SeenUpload } from "../test/file-handlers";
import {
  publicProblemHandler,
  publicResultPagesHandler,
  publicResultsProblemHandler,
  publishedSurveyHandler,
  sampleResponseFile,
  sampleResponseId,
  samplePublishedSurvey,
  submitResponseHandler,
  uploadResponseFileHandler,
  type SeenSubmission,
} from "../test/public-handlers";
import { server } from "../test/server";
import { ApiError } from "./client";
import {
  getPublishedSurvey,
  loadPublicResults,
  publicResultKeys,
  submitResponse,
  uploadResponseFile,
} from "./public";

const surveyId = samplePublishedSurvey.id;

describe("getPublishedSurvey", () => {
  it("reads the survey without a clientId when none is given", async () => {
    const urls: URL[] = [];
    server.use(
      publishedSurveyHandler(samplePublishedSurvey, { onRequest: (url) => urls.push(url) }),
    );

    await expect(getPublishedSurvey(surveyId)).resolves.toEqual(samplePublishedSurvey);

    expect(urls.map((url) => url.pathname + url.search)).toEqual([
      `/api/v1/public/surveys/${surveyId}`,
    ]);
  });

  it("sends the clientId when given and resolves to the completed flag", async () => {
    const urls: URL[] = [];
    server.use(
      publishedSurveyHandler(samplePublishedSurvey, {
        completedFor: "client-1",
        onRequest: (url) => urls.push(url),
      }),
    );

    await expect(getPublishedSurvey(surveyId, "client-1")).resolves.toEqual({
      ...samplePublishedSurvey,
      completed: true,
    });

    expect(urls.map((url) => url.searchParams.get("clientId"))).toEqual(["client-1"]);
  });

  it("rejects an unavailable survey with the survey-not-available ApiError", async () => {
    server.use(publishedSurveyHandler());

    const error = await getPublishedSurvey("99999999-0000-4000-8000-a00000000099").catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem).toMatchObject({
      status: 404,
      code: "survey-not-available",
    });
  });
});

describe("submitResponse", () => {
  it("posts the answers as JSON with the Idempotency-Key and resolves to the id", async () => {
    const seen: SeenSubmission[] = [];
    server.use(submitResponseHandler((submission) => seen.push(submission)));

    await expect(
      submitResponse(surveyId, { data: { satisfaction: 4 }, clientId: "client-1" }, "key-1"),
    ).resolves.toEqual({ id: sampleResponseId });

    expect(seen).toEqual([
      {
        path: `/api/v1/public/surveys/${surveyId}/responses`,
        idempotencyKey: "key-1",
        contentType: "application/json",
        body: { data: { satisfaction: 4 }, clientId: "client-1" },
      },
    ]);
  });

  it("rejects a 409 with the already-completed ApiError", async () => {
    server.use(
      publicProblemHandler("post", "/public/surveys/:surveyId/responses", 409, "already-completed"),
    );

    const error = await submitResponse(surveyId, { data: {} }, "key-1").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem).toMatchObject({ status: 409, code: "already-completed" });
  });
});

describe("uploadResponseFile", () => {
  it("posts one multipart part named file, with the file's name, and resolves to the stored file", async () => {
    const seen: SeenUpload[] = [];
    server.use(uploadResponseFileHandler(sampleResponseFile, (upload) => seen.push(upload)));
    const file = new File([new Uint8Array([37, 80, 68, 70])], "receipt.pdf");

    await expect(uploadResponseFile(surveyId, file)).resolves.toEqual(sampleResponseFile);

    expect(seen).toEqual([
      {
        path: `/api/v1/public/surveys/${surveyId}/files`,
        csrf: null,
        contentType: expect.stringMatching(/^multipart\/form-data; boundary=/) as string,
        parts: [{ name: "file", fileName: "receipt.pdf", bytes: [37, 80, 68, 70] }],
      },
    ]);
  });

  it("rejects a 413 with the payload-too-large ApiError", async () => {
    server.use(
      publicProblemHandler("post", "/public/surveys/:surveyId/files", 413, "payload-too-large"),
    );

    const error = await uploadResponseFile(surveyId, new File(["x"], "a.txt")).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem).toMatchObject({ status: 413, code: "payload-too-large" });
  });
});

describe("loadPublicResults", () => {
  const resultSurvey = { id: surveyId, name: "Customer feedback", definition: {} };
  const item = (n: number) => ({ submittedAt: `2026-01-01T00:0${n}:00.000Z`, data: { q1: n } });

  it("reads page after page, joins the items and keeps the survey of page 1", async () => {
    const seen: URL[] = [];
    server.use(
      publicResultPagesHandler(resultSurvey, [[item(1), item(2)], [item(3)]], (url) =>
        seen.push(url),
      ),
    );

    await expect(loadPublicResults(surveyId)).resolves.toEqual({
      survey: resultSurvey,
      items: [item(1), item(2), item(3)],
    });

    expect(
      seen.map((url) => [url.searchParams.get("limit"), url.searchParams.get("cursor")]),
    ).toEqual([
      ["1000", null],
      ["1000", "c1"],
    ]);
    expect(publicResultKeys.all("ABC")).toEqual(["public-results", "abc"]);
  });

  it("rejects survey-not-available with the 404 ApiError", async () => {
    server.use(publicResultsProblemHandler(404, "survey-not-available"));

    const error = await loadPublicResults(surveyId).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem).toMatchObject({
      status: 404,
      code: "survey-not-available",
    });
  });

  it("rejects when the server repeats the cursor", async () => {
    server.use(
      mswHttp.get("*/api/v1/public/surveys/:surveyId/results", () =>
        HttpResponse.json({ survey: resultSurvey, items: [], nextCursor: "c1" }),
      ),
    );

    await expect(loadPublicResults(surveyId)).rejects.toThrow(
      "The server sent the same cursor twice.",
    );
  });
});
