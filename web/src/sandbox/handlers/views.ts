// Mirrors server/src/views/ (handlers.ts, service.ts) and providers/memory-views.ts: results
// layouts kept per user and survey. Until a user saves or resets, the survey's legacy layout (from
// the seed) answers; a reset answers `404 view-not-found` even where a legacy layout exists.
import { HttpResponse } from "msw";
import type { SandboxJson } from "../seed-types";
import type { SandboxData } from "../store";
import { lower, mutate, readJson, requireSession, requiredObject, view } from "./common";
import type { HandlerContext } from "./context";
import { http } from "./http";
import { badRequest, guarded, ProblemError } from "./problems";
import { visibleSurvey } from "./survey-access";

const viewNotFound = () =>
  new ProblemError({ code: "view-not-found", status: 404, title: "View not found" });

/** The path's view must be `summary` or `table` (the contract's enum): 400 otherwise. */
function viewName(value: string): "summary" | "table" {
  if (value === "summary" || value === "table") return value;
  throw badRequest(undefined, [
    { pointer: "/view", detail: "must be equal to one of the allowed values" },
  ]);
}

/** The user's saved layouts of one survey (`null` is a reset), or undefined. */
const layoutsOf = (data: SandboxData, userId: string, surveyId: string) =>
  data.savedViews[lower(userId)]?.[surveyId];

export function viewHandlers(ctx: HandlerContext) {
  return [
    http.get("/surveys/{surveyId}/views/{view}", ({ params, cookies }) =>
      guarded(() => {
        requireSession(ctx, cookies);
        const name = viewName(params.view);
        return view(ctx, cookies, (data, user) => {
          const { survey } = visibleSurvey(data, user, params.surveyId);
          const own = layoutsOf(data, user.id, survey.id)?.[name];
          const state: SandboxJson | null | undefined =
            own === undefined ? data.legacyViews[survey.id]?.[name] : own;
          if (state === undefined || state === null) throw viewNotFound();
          return HttpResponse.json(state);
        });
      }),
    ),

    http.put("/surveys/{surveyId}/views/{view}", ({ params, request, cookies }) =>
      guarded(async () => {
        requireSession(ctx, cookies);
        const name = viewName(params.view);
        const state = requiredObject(await readJson(request));
        await mutate(ctx, cookies, (data, user) => {
          const { survey } = visibleSurvey(data, user, params.surveyId);
          const byUser = (data.savedViews[lower(user.id)] ??= {});
          (byUser[survey.id] ??= {})[name] = structuredClone(state);
        });
        return new HttpResponse(null, { status: 204 });
      }),
    ),

    http.delete("/surveys/{surveyId}/views/{view}", ({ params, cookies }) =>
      guarded(async () => {
        requireSession(ctx, cookies);
        const name = viewName(params.view);
        await mutate(ctx, cookies, (data, user) => {
          const { survey } = visibleSurvey(data, user, params.surveyId);
          const byUser = (data.savedViews[lower(user.id)] ??= {});
          (byUser[survey.id] ??= {})[name] = null;
        });
        return new HttpResponse(null, { status: 204 });
      }),
    ),
  ];
}
