// Mirrors server/src/results/service.ts (`list`, `stats`, `deleteResults`) and handlers.ts: the
// signed-in side of a survey's results. A response is returned as results/export.ts `responseJson`
// does (no `partial`). The sandbox code does not import server/src.
import { HttpResponse } from "msw";
import { mutate, parsePagingQuery, requireSession, RESULTS_PAGE, view } from "./common";
import type { HandlerContext } from "./context";
import { http } from "./http";
import { guarded } from "./problems";
import { responseOrder, responsePage } from "./public";
import { modifiableSurvey, visibleSurvey } from "./survey-access";

export function resultsHandlers(ctx: HandlerContext) {
  return [
    http.get("/surveys/{surveyId}/results", ({ params, request, cookies }) =>
      guarded(() => {
        requireSession(ctx, cookies);
        const { limit, cursor } = parsePagingQuery(new URL(request.url), RESULTS_PAGE);
        return view(ctx, cookies, (data, user) => {
          const { survey } = visibleSurvey(data, user, params.surveyId);
          const { items, nextCursor } = responsePage(data, survey.id, limit, cursor);
          return HttpResponse.json({
            items: items.map(({ id, submittedAt, data: answers, clientId, respondentIp }) => ({
              id,
              submittedAt,
              data: answers,
              ...(clientId !== undefined && { clientId }),
              ...(respondentIp !== undefined && { respondentIp }),
            })),
            nextCursor,
          });
        });
      }),
    ),

    http.get("/surveys/{surveyId}/results/stats", ({ params, cookies }) =>
      guarded(() =>
        view(ctx, cookies, (data, user) => {
          const { survey } = visibleSurvey(data, user, params.surveyId);
          const rows = [...(data.responses[survey.id] ?? [])].sort(responseOrder);
          return HttpResponse.json({
            count: rows.length,
            firstSubmittedAt: rows[0]?.submittedAt ?? null,
            lastSubmittedAt: rows.at(-1)?.submittedAt ?? null,
          });
        }),
      ),
    ),

    // Every response, completion marker, idempotency key and respondent file; the editor's assets stay.
    http.delete("/surveys/{surveyId}/results", ({ params, cookies }) =>
      guarded(() => {
        mutate(ctx, cookies, (data, user) => {
          const { survey } = modifiableSurvey(data, user, params.surveyId);
          data.files = data.files.filter(
            (file) => !(file.surveyId === survey.id && file.kind === "respondent"),
          );
          delete data.responses[survey.id];
          delete data.completions[survey.id];
          // A key points at a response that is gone; keeping it would only take up storage.
          delete data.idempotencyKeys[survey.id];
        });
        return new HttpResponse(null, { status: 204 });
      }),
    ),
  ];
}
