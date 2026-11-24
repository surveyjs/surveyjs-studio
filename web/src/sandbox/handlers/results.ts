// Mirrors server/src/results/service.ts (`list`, `stats`, `deleteResults`) and handlers.ts: the
// signed-in side of a survey's results. A response is returned as results/export.ts `responseJson`
// does (`partial: true` only when true; runs fold, ADR 0038). The sandbox code does not import server/src.
import { HttpResponse } from "msw";
import { runHolding } from "../runs";
import {
  checkPathId,
  lower,
  mutate,
  parsePagingQuery,
  requireSession,
  RESULTS_PAGE,
  view,
} from "./common";
import type { HandlerContext } from "./context";
import { http } from "./http";
import { guarded, notFound } from "./problems";
import { publicWindow, responseOrder, responsePage } from "./public";
import { modifiableSurvey, visibleSurvey } from "./survey-access";

export function resultsHandlers(ctx: HandlerContext) {
  return [
    http.get("/surveys/{surveyId}/results", ({ params, request, cookies }) =>
      guarded(() => {
        requireSession(ctx, cookies);
        const url = new URL(request.url);
        const { limit, cursor } = parsePagingQuery(url, RESULTS_PAGE);
        // Before any lookup, as the validator refuses a malformed date-time.
        const window = publicWindow(url.searchParams);
        return view(ctx, cookies, (data, user) => {
          const { survey } = visibleSurvey(data, user, params.surveyId);
          const { items, nextCursor } = responsePage(data, survey.id, limit, cursor, false, window);
          return HttpResponse.json({
            items: items.map(
              ({ id, submittedAt, data: answers, clientId, respondentIp, partial }) => ({
                id,
                submittedAt,
                data: answers,
                ...(clientId !== undefined && { clientId }),
                ...(respondentIp !== undefined && { respondentIp }),
                ...(partial && { partial: true }),
              }),
            ),
            nextCursor,
          });
        });
      }),
    ),

    http.get("/surveys/{surveyId}/results/stats", ({ params, cookies }) =>
      guarded(() =>
        view(ctx, cookies, (data, user) => {
          const { survey } = visibleSurvey(data, user, params.surveyId);
          // The complete rows only: a partial row is not a response yet (ADR 0038).
          const rows = (data.responses[survey.id] ?? [])
            .filter((row) => !row.partial)
            .sort(responseOrder);
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
      guarded(async () => {
        await mutate(ctx, cookies, (data, user) => {
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

    // The whole run holding the save, and its client's completion marker unless a later run exists.
    http.delete("/surveys/{surveyId}/results/{responseId}", ({ params, cookies }) =>
      guarded(async () => {
        requireSession(ctx, cookies);
        checkPathId(params.responseId, "responseId");
        await mutate(ctx, cookies, (data, user) => {
          const { survey } = modifiableSurvey(data, user, params.surveyId);
          const rows = [...(data.responses[survey.id] ?? [])].sort(responseOrder);
          const found = runHolding(rows, params.responseId);
          if (!found) throw notFound();
          const gone = new Set(found.run.map((row) => lower(row.id)));
          data.responses[survey.id] = (data.responses[survey.id] ?? []).filter(
            (row) => !gone.has(lower(row.id)),
          );
          const clientId = found.run[0]?.clientId;
          if (clientId !== undefined && !found.laterRun)
            delete data.completions[survey.id]?.[clientId];
        });
        return new HttpResponse(null, { status: 204 });
      }),
    ),
  ];
}
