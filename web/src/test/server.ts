import { HttpResponse, http as mswHttp } from "msw";
import { setupServer } from "msw/node";
import { createOpenApiHttp } from "openapi-msw";
import type { components, paths } from "@my-surveys/contract/types";

export const http = createOpenApiHttp<paths>({ baseUrl: "*/api/v1" });
export const server = setupServer();

export const appConfig: components["schemas"]["AppConfig"] = {
  edition: "self-hosted",
  // The plain shell: the routing tests check the shell interface, not the surveyjs.io look
  // (src/shell/surveyjs-site has its own tests).
  shell: "plain",
  authMethods: ["surveyjs"],
  surveyjsLicenseKey: null,
  limits: {
    maxAssetBytesPerSurvey: 52428800,
    maxFileBytes: 10485760,
    maxResponseBytes: 1048576,
    maxDocumentBytes: 30000000,
  },
};

export function configHandler(config = appConfig) {
  return http.get("/config", ({ response }) => response(200).json(config));
}

export function problemHandler(status: number, code: string, title: string) {
  return mswHttp.get("*/api/v1/config", () =>
    HttpResponse.json(
      { type: `https://my-surveys.surveyjs.io/problems/${code}`, title, status, code },
      { status, headers: { "Content-Type": "application/problem+json" } },
    ),
  );
}

export const currentUser: components["schemas"]["CurrentUser"] = {
  id: "00000000-0000-4000-8000-000000000001",
  displayName: "Olivia Owner",
  email: "owner@example.test",
  avatarUrl: null,
  notices: [],
};

export function meHandler(user = currentUser) {
  return http.get("/me", ({ response }) => response(200).json(user));
}

export function unauthenticatedHandler() {
  return mswHttp.get("*/api/v1/me", () =>
    HttpResponse.json(
      {
        type: "https://my-surveys.surveyjs.io/problems/unauthenticated",
        title: "Sign in required",
        status: 401,
        code: "unauthenticated",
      },
      { status: 401, headers: { "Content-Type": "application/problem+json" } },
    ),
  );
}

type Survey = components["schemas"]["Survey"];
type SurveyPage = components["schemas"]["SurveyPage"];
type Project = components["schemas"]["Project"];
type ProjectPage = components["schemas"]["ProjectPage"];

export const sampleSurvey: Survey = {
  id: "11111111-0000-4000-8000-000000000001",
  name: "Customer feedback",
  projectId: null,
  published: false,
  archived: false,
  createdAt: "2026-04-01T09:00:00.000Z",
  updatedAt: "2026-04-02T10:00:00.000Z",
  postId: "11111111-0000-4000-8000-0000000000a1",
  resultId: "11111111-0000-4000-8000-0000000000b1",
  permissions: { canModify: true },
  settings: { publicResults: false, storeRespondentIp: false },
};

export const sampleProject: Project = {
  id: "55555555-0000-4000-8000-a00000000001",
  name: "Marketing",
  ownerId: currentUser.id,
  role: "admin",
  memberCount: 3,
  createdAt: "2025-11-21T10:00:00.000Z",
};

function badRequest() {
  return HttpResponse.json(
    { type: "about:blank", title: "Bad request", status: 400, code: "bad-request" },
    { status: 400, headers: { "Content-Type": "application/problem+json" } },
  );
}

/**
 * Answers `GET /surveys` from `pagesByCursor`: the key is the request's `cursor`, or "" for the first
 * page. `onRequest` sees every request URL.
 */
export function surveysHandler(
  pagesByCursor: Record<string, SurveyPage>,
  onRequest?: (url: URL) => void,
) {
  // Untyped msw handler: an unknown cursor answers 400, which `response()` cannot express.
  return mswHttp.get("*/api/v1/surveys", ({ request }) => {
    const url = new URL(request.url);
    onRequest?.(url);
    const page = pagesByCursor[url.searchParams.get("cursor") ?? ""];
    return page === undefined ? badRequest() : HttpResponse.json(page);
  });
}

/** Answers `POST /surveys` with 201 and `survey`; `onBody` sees the request body. */
export function createSurveyHandler(survey = sampleSurvey, onBody?: (body: unknown) => void) {
  return http.post("/surveys", async ({ request, response }) => {
    onBody?.(await request.json());
    return response(201).json(survey, { headers: { Location: `/api/v1/surveys/${survey.id}` } });
  });
}

export function surveyHandler(survey = sampleSurvey) {
  return mswHttp.get("*/api/v1/surveys/:surveyId", ({ params }) =>
    params.surveyId === survey.id
      ? HttpResponse.json(survey)
      : HttpResponse.json(
          { type: "about:blank", title: "Not found", status: 404, code: "not-found" },
          { status: 404, headers: { "Content-Type": "application/problem+json" } },
        ),
  );
}

/** Answers `GET /projects` from `pagesByCursor` (key: the request's `cursor`, "" for the first page). */
export function projectsHandler(pagesByCursor: Record<string, ProjectPage>) {
  return mswHttp.get("*/api/v1/projects", ({ request }) => {
    const page = pagesByCursor[new URL(request.url).searchParams.get("cursor") ?? ""];
    return page === undefined ? badRequest() : HttpResponse.json(page);
  });
}

/**
 * What the My Surveys page (`/`) loads besides `/config` and `/me`: one page of personal surveys
 * (also answering the archived check) and no projects.
 */
export function surveyListPageHandlers(surveys: Survey[] = [sampleSurvey]) {
  return [
    surveysHandler({ "": { items: surveys, nextCursor: null } }),
    projectsHandler({ "": { items: [], nextCursor: null } }),
  ];
}

/**
 * Answers `PATCH /surveys/{id}` with 200 and `survey`; `onRequest` sees the parsed body and the
 * request's content type.
 */
export function updateSurveyHandler(
  survey = sampleSurvey,
  onRequest?: (body: unknown, contentType: string | null) => void,
) {
  return http.patch("/surveys/{surveyId}", async ({ request, response }) => {
    onRequest?.(await request.json(), request.headers.get("content-type"));
    return response(200).json(survey);
  });
}

/** Answers `POST /surveys/{id}/clones` with 201 and `copy`; `onRequest` sees the request. */
export function cloneSurveyHandler(copy = sampleSurvey, onRequest?: (request: Request) => void) {
  return http.post("/surveys/{surveyId}/clones", ({ request, response }) => {
    onRequest?.(request);
    return response(201).json(copy, { headers: { Location: `/api/v1/surveys/${copy.id}` } });
  });
}

/** Answers `DELETE /surveys/{id}` with 204; `onRequest` sees the request. */
export function deleteSurveyHandler(onRequest?: (request: Request) => void) {
  return http.delete("/surveys/{surveyId}", ({ request, response }) => {
    onRequest?.(request);
    return response(204).empty();
  });
}

/** Answers `method` on `/surveys/{id}` (and `/clones`) with a 409 Problem. */
export function surveyActionProblemHandler(method: "patch" | "delete" | "post") {
  const path =
    method === "post" ? "*/api/v1/surveys/:surveyId/clones" : "*/api/v1/surveys/:surveyId";
  return mswHttp[method](path, () =>
    HttpResponse.json(
      {
        type: "https://my-surveys.surveyjs.io/problems/survey-not-archived",
        title: "Survey is not archived",
        status: 409,
        code: "survey-not-archived",
      },
      { status: 409, headers: { "Content-Type": "application/problem+json" } },
    ),
  );
}
