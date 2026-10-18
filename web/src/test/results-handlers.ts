import { HttpResponse, http as mswHttp } from "msw";
import type { components } from "@my-surveys/contract/types";

type SurveyResponse = components["schemas"]["SurveyResponse"];
type ViewState = components["schemas"]["ViewState"];

const PREFIX = "*/api/v1/surveys/:surveyId";

function problem(status: number, code: string, title = code) {
  return HttpResponse.json(
    { type: `https://my-surveys.surveyjs.io/problems/${code}`, title, status, code },
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

/** `n` responses `r1`…`rn`, each answering `q1` with its number, submitted one minute apart. */
export function sampleResponses(n: number, firstNumber = 1): SurveyResponse[] {
  return Array.from({ length: n }, (_, i) => {
    const number = firstNumber + i;
    return {
      id: `r${number}`,
      submittedAt: new Date(Date.UTC(2026, 0, 1, 0, number)).toISOString(),
      data: { q1: number },
    };
  });
}

/**
 * Answers `GET /surveys/{id}/results`: page `i` for cursor `c{i}` (the first without a cursor),
 * `nextCursor` `c{i+1}` or null on the last page. `onRequest` sees every request's URL.
 */
export function resultPagesHandler(pages: SurveyResponse[][], onRequest?: (url: URL) => void) {
  return mswHttp.get(`${PREFIX}/results`, ({ request }) => {
    const url = new URL(request.url);
    onRequest?.(url);
    const cursor = url.searchParams.get("cursor");
    const index = cursor === null ? 0 : Number(cursor.slice(1));
    const items = pages[index];
    if (items === undefined) return problem(400, "bad-request");
    return HttpResponse.json({
      items,
      nextCursor: index + 1 < pages.length ? `c${index + 1}` : null,
    });
  });
}

/** Answers `GET /surveys/{id}/views/{view}`: 200 with `state`, or 404 `view-not-found` when null. */
export function viewHandler(view: string, state: ViewState | null) {
  return mswHttp.get(`${PREFIX}/views/${view}`, () =>
    state === null ? problem(404, "view-not-found") : HttpResponse.json(state),
  );
}

/** What a view save handler saw. */
export interface SeenViewSave {
  readonly body: unknown;
  readonly csrf: string | null;
}

/** Answers `PUT /surveys/{id}/views/{view}` with 204. */
export function saveViewHandler(view: string, onSave?: (saved: SeenViewSave) => void) {
  return mswHttp.put(`${PREFIX}/views/${view}`, async ({ request }) => {
    onSave?.({ body: await request.json(), csrf: request.headers.get("X-CSRF-Token") });
    return new HttpResponse(null, { status: 204 });
  });
}

/** Answers `DELETE /surveys/{id}/views/{view}` with 204. */
export function resetViewHandler(view: string, onReset?: () => void) {
  return mswHttp.delete(`${PREFIX}/views/${view}`, () => {
    onReset?.();
    return new HttpResponse(null, { status: 204 });
  });
}

/** Answers `method` of a view with the Problem `status` / `code`. */
export function viewProblemHandler(
  method: "get" | "put" | "delete",
  view: string,
  status: number,
  code: string,
) {
  return mswHttp[method](`${PREFIX}/views/${view}`, () => problem(status, code));
}
