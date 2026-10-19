import { describe, expect, it } from "vitest";
import type { SeenUpload } from "../test/file-handlers";
import {
  publicProblemHandler,
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
import { getPublishedSurvey, submitResponse, uploadResponseFile } from "./public";

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
