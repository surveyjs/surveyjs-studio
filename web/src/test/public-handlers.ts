// msw handlers for the respondent's endpoints (`/public/surveys/…`), used by the run page tests.
import { HttpResponse, http as mswHttp } from "msw";
import type { PublishedSurvey } from "../api/public";
import { multipartParts, sampleStoredFile, type SeenUpload } from "./file-handlers";
import { sampleSurvey } from "./server";

/** A published survey without "Limit to one response". */
export const samplePublishedSurvey: PublishedSurvey = {
  id: sampleSurvey.id,
  name: "Customer feedback",
  definition: { elements: [{ type: "rating", name: "satisfaction" }] },
  theme: { themeName: "default", cssVariables: { "--sjs-primary-backcolor": "#19b394" } },
};

/** The same survey with "Limit to one response" on (the server names the cookie after the id). */
export const limitedPublishedSurvey: PublishedSurvey = {
  ...samplePublishedSurvey,
  definition: { ...samplePublishedSurvey.definition, cookieName: sampleSurvey.id },
};

/** A respondent's stored file. */
export const sampleResponseFile = { ...sampleStoredFile, name: "receipt.pdf" };

const titles: Readonly<Record<string, string>> = {
  "bad-request": "Bad request",
  "survey-not-available": "This survey is not available",
  "already-completed": "Already completed",
  "payload-too-large": "Payload too large",
  "rate-limited": "Too many requests",
  "validation-failed": "Validation failed",
  "internal-error": "Server error",
};

function problem(status: number, code: string) {
  return HttpResponse.json(
    {
      type: `https://my-surveys.surveyjs.io/problems/${code}`,
      title: titles[code] ?? code,
      status,
      code,
    },
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

/**
 * Answers `GET /public/surveys/{id}` with `survey`, and `404 survey-not-available` for another id.
 * With a `clientId` query the answer has `completed`: true only for `completedFor`. `onRequest`
 * sees every request URL.
 */
export function publishedSurveyHandler(
  survey: PublishedSurvey = samplePublishedSurvey,
  options: { completedFor?: string; onRequest?: (url: URL) => void } = {},
) {
  return mswHttp.get("*/api/v1/public/surveys/:surveyId", ({ request, params }) => {
    const url = new URL(request.url);
    options.onRequest?.(url);
    if (params.surveyId !== survey.id) return problem(404, "survey-not-available");
    const clientId = url.searchParams.get("clientId");
    return HttpResponse.json(
      clientId === null ? survey : { ...survey, completed: clientId === options.completedFor },
    );
  });
}

/** What a submit handler saw. */
export interface SeenSubmission {
  readonly path: string;
  readonly idempotencyKey: string | null;
  readonly contentType: string | null;
  readonly body: unknown;
}

export const sampleResponseId = "77777777-0000-5000-8000-000000000001";

/** Answers `POST /public/surveys/{id}/responses` with `201 { id }`; `onRequest` sees the request. */
export function submitResponseHandler(onRequest?: (seen: SeenSubmission) => void) {
  return mswHttp.post("*/api/v1/public/surveys/:surveyId/responses", async ({ request }) => {
    onRequest?.({
      path: new URL(request.url).pathname,
      idempotencyKey: request.headers.get("Idempotency-Key"),
      contentType: request.headers.get("Content-Type"),
      body: await request.json(),
    });
    return HttpResponse.json({ id: sampleResponseId }, { status: 201 });
  });
}

/** Answers `POST /public/surveys/{id}/files` with 201 and `stored`; `onUpload` sees the request. */
export function uploadResponseFileHandler(
  stored = sampleResponseFile,
  onUpload?: (upload: SeenUpload) => void,
) {
  return mswHttp.post("*/api/v1/public/surveys/:surveyId/files", async ({ request }) => {
    const contentType = request.headers.get("Content-Type");
    onUpload?.({
      path: new URL(request.url).pathname,
      csrf: request.headers.get("X-CSRF-Token"),
      contentType,
      parts: multipartParts(new Uint8Array(await request.arrayBuffer()), contentType),
    });
    return HttpResponse.json(stored, {
      status: 201,
      headers: { Location: `/api/v1/public/files/${stored.id}` },
    });
  });
}

/**
 * Answers `method` on `path` (after `/api/v1`, msw syntax: `/public/surveys/:surveyId`) with the
 * Problem of `code`.
 */
export function publicProblemHandler(
  method: "get" | "post",
  path: string,
  status: number,
  code: string,
) {
  return mswHttp[method](`*/api/v1${path}`, () => problem(status, code));
}
