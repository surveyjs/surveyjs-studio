// Mirrors server/src/views/ (handlers.ts, service.ts) and providers/memory-views.ts: results
// layouts kept per user and survey, and the survey's shared layouts (the text kept verbatim). Until a
// user saves or resets, the shared layout of the view's kind answers when its text is a JSON object;
// a reset answers `404 view-not-found` even where a shared layout exists.
import { HttpResponse } from "msw";
import type { SandboxJson, SandboxLayoutKind } from "../seed-types";
import type { SandboxData } from "../store";
import {
  failOn,
  isRecord,
  lower,
  mutate,
  readJson,
  requireSession,
  requiredObject,
  view,
} from "./common";
import type { HandlerContext } from "./context";
import { http } from "./http";
import { badRequest, guarded, ProblemError, type ProblemFieldError } from "./problems";
import { modifiableSurvey, visibleSurvey } from "./survey-access";

const viewNotFound = () =>
  new ProblemError({ code: "view-not-found", status: 404, title: "View not found" });

/** The path's view must be `summary` or `table` (the contract's enum): 400 otherwise. */
function viewName(value: string): "summary" | "table" {
  if (value === "summary" || value === "table") return value;
  throw badRequest(undefined, [
    { pointer: "/view", detail: "must be equal to one of the allowed values" },
  ]);
}

const layoutNotFound = () =>
  new ProblemError({ code: "layout-not-found", status: 404, title: "Layout not found" });

/** The path's kind must be `table`, `summary` or `columns` (the contract's enum): 400 otherwise. */
function layoutKind(value: string): SandboxLayoutKind {
  if (value === "table" || value === "summary" || value === "columns") return value;
  throw badRequest(undefined, [
    { pointer: "/kind", detail: "must be equal to one of the allowed values" },
  ]);
}

/** A layout text as a view: its JSON object, or null when it is not one (domain/view-state.ts). */
function viewStateOf(text: string): SandboxJson | null {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
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
          const text = data.layouts[survey.id]?.[name];
          const state: SandboxJson | null | undefined =
            own === undefined ? (text === undefined ? null : viewStateOf(text)) : own;
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

    http.get("/surveys/{surveyId}/layouts/{kind}", ({ params, cookies }) =>
      guarded(() => {
        requireSession(ctx, cookies);
        const kind = layoutKind(params.kind);
        return view(ctx, cookies, (data, user) => {
          const { survey } = visibleSurvey(data, user, params.surveyId);
          const text = data.layouts[survey.id]?.[kind];
          if (text === undefined) throw layoutNotFound();
          return HttpResponse.json({ text });
        });
      }),
    ),

    http.put("/surveys/{surveyId}/layouts/{kind}", ({ params, request, cookies }) =>
      guarded(async () => {
        requireSession(ctx, cookies);
        const kind = layoutKind(params.kind);
        const body = requiredObject(await readJson(request));
        const { text } = body;
        const errors: ProblemFieldError[] = [];
        if (typeof text !== "string") {
          errors.push({
            pointer: text === undefined ? "" : "/text",
            detail: text === undefined ? "must have required property 'text'" : "must be string",
          });
        } else if (text.length === 0) {
          errors.push({ pointer: "/text", detail: "must NOT have fewer than 1 characters" });
        }
        failOn(errors);
        await mutate(ctx, cookies, (data, user) => {
          const { survey } = modifiableSurvey(data, user, params.surveyId);
          (data.layouts[survey.id] ??= {})[kind] = text as string;
        });
        return new HttpResponse(null, { status: 204 });
      }),
    ),

    http.delete("/surveys/{surveyId}/layouts/{kind}", ({ params, cookies }) =>
      guarded(async () => {
        requireSession(ctx, cookies);
        const kind = layoutKind(params.kind);
        await mutate(ctx, cookies, (data, user) => {
          const { survey } = modifiableSurvey(data, user, params.surveyId);
          delete data.layouts[survey.id]?.[kind];
        });
        return new HttpResponse(null, { status: 204 });
      }),
    ),
  ];
}
