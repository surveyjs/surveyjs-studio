import type { paths } from "@surveyjs-studio/contract/types";
import { createOpenApiHttp } from "openapi-msw";

/** Handlers typed by the contract (never the package's main entry, which imports `node:url`). */
export const http = createOpenApiHttp<paths>({ baseUrl: "*/api/v1" });
