import { HttpResponse, http as mswHttp } from "msw";
import type { components } from "@my-surveys/contract/types";
import { http } from "./server";

type HistoryPage = components["schemas"]["HistoryPage"];

/** Answers `GET /surveys/{id}/definition` with 200, `content` and the `ETag` header `etag`. */
export function definitionHandler(content: Record<string, unknown>, etag: string | null = '"v1"') {
  // Untyped when `etag` is null: the contract requires the header, this is the broken-server case.
  if (etag === null) {
    return mswHttp.get("*/api/v1/surveys/:surveyId/definition", () => HttpResponse.json(content));
  }
  return http.get("/surveys/{surveyId}/definition", ({ response }) =>
    response(200).json(content, { headers: { ETag: etag } }),
  );
}

/** Answers `GET /surveys/{id}/theme` with 200, `content` and the `ETag` header `etag`. */
export function themeHandler(content: Record<string, unknown>, etag = '"t1"') {
  return http.get("/surveys/{surveyId}/theme", ({ response }) =>
    response(200).json(content, { headers: { ETag: etag } }),
  );
}

/** What a content PUT handler saw. */
export interface SavedContent {
  ifMatch: string | null;
  body: unknown;
}

/** Answers `PUT /surveys/{id}/definition` with 204 and `newEtag`; `onSave` sees `If-Match` and the body. */
export function saveDefinitionHandler(newEtag = '"v2"', onSave?: (saved: SavedContent) => void) {
  return http.put("/surveys/{surveyId}/definition", async ({ request, response }) => {
    onSave?.({ ifMatch: request.headers.get("If-Match"), body: await request.json() });
    return response(204).empty({ headers: { ETag: newEtag } });
  });
}

/** Answers `PUT /surveys/{id}/theme` with 204 and `newEtag`; `onSave` sees `If-Match` and the body. */
export function saveThemeHandler(newEtag = '"t2"', onSave?: (saved: SavedContent) => void) {
  return http.put("/surveys/{surveyId}/theme", async ({ request, response }) => {
    onSave?.({ ifMatch: request.headers.get("If-Match"), body: await request.json() });
    return response(204).empty({ headers: { ETag: newEtag } });
  });
}

/** Answers a PUT of `document` with the 412 edit-conflict Problem. */
export function editConflictHandler(document: "definition" | "theme") {
  return mswHttp.put(`*/api/v1/surveys/:surveyId/${document}`, () =>
    HttpResponse.json(
      {
        type: "https://my-surveys.surveyjs.io/problems/edit-conflict",
        title: "The survey was changed by someone else",
        status: 412,
        code: "edit-conflict",
      },
      { status: 412, headers: { "Content-Type": "application/problem+json" } },
    ),
  );
}

/** Answers `GET /surveys/{id}/history` from `pagesByCursor` (key: the `cursor`, "" for the first page). */
export function historyHandler(
  pagesByCursor: Record<string, HistoryPage>,
  onRequest?: (url: URL) => void,
) {
  return mswHttp.get("*/api/v1/surveys/:surveyId/history", ({ request }) => {
    const url = new URL(request.url);
    onRequest?.(url);
    const page = pagesByCursor[url.searchParams.get("cursor") ?? ""];
    return page === undefined
      ? HttpResponse.json(
          { type: "about:blank", title: "Bad request", status: 400, code: "bad-request" },
          { status: 400, headers: { "Content-Type": "application/problem+json" } },
        )
      : HttpResponse.json(page);
  });
}
