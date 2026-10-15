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
