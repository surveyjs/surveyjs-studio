import { HttpResponse, http as mswHttp } from "msw";
import { setupServer } from "msw/node";
import { createOpenApiHttp } from "openapi-msw";
import type { components, paths } from "@my-surveys/contract/types";

export const http = createOpenApiHttp<paths>({ baseUrl: "*/api/v1" });
export const server = setupServer();

export const appConfig: components["schemas"]["AppConfig"] = {
  edition: "self-hosted",
  shell: "surveyjs-site",
  authMethods: ["surveyjs"],
  surveyjsLicenseKey: null,
  limits: { maxAssetBytesPerSurvey: 52428800, maxFileBytes: 10485760, maxResponseBytes: 1048576 },
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
