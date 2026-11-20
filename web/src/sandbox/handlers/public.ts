// Mirrors the public run operations of the server: server/src/results/service.ts (`getPublished`,
// `submit`, `publicPage`), one-response.ts (the one-response cookie rule), availability.ts and
// definition.ts. The idempotency key maps to the stored response id (the server derives it as a
// UUID v5 of the key: the same replay answer). No IP address is stored (the spec).
import { HttpResponse } from "msw";
import type { SandboxJson, SandboxResponse, SandboxSurvey } from "../seed-types";
import type { SandboxData } from "../store";
import {
  checkPathId,
  compare,
  isRecord,
  parsePagingQuery,
  readJson,
  requiredObject,
  RESULTS_PAGE,
} from "./common";
import { requireHosted, type HandlerContext } from "./context";
import { responseOfRun, foldRuns } from "../runs";
import { formatEtag, ifNoneMatchHits, versionOf } from "./content";
import { privateKeysOf, withoutKeys } from "./definition";
import { http } from "./http";
import { decodeResultsCursor, encodeResultsCursor } from "./paging";
import { summarizeQuestion } from "./question-summary";
import {
  badRequest,
  guarded,
  notFound,
  ProblemError,
  surveyNotAvailable,
  validationFailed,
  type ProblemFieldError,
} from "./problems";

/** The `ClientId` schema: 1 to 256 characters, none of `/ \ # ?` or a control character. */
// eslint-disable-next-line no-control-regex -- the contract's pattern names control characters
const CLIENT_ID = /^[^/\\#?\u0000-\u001F\u007F-\u009F]+$/;

function clientIdProblem(value: string): string | null {
  if (value.length === 0) return "must NOT have fewer than 1 characters";
  if ([...value].length > 256) return "must NOT have more than 256 characters";
  return CLIENT_ID.test(value)
    ? null
    : 'must match pattern "^[^/\\\\#?\\u0000-\\u001F\\u007F-\\u009F]+$"';
}

/** The survey when it exists and is published, archived or not (availability.ts). */
export function availableSurvey(data: SandboxData, surveyId: string): SandboxSurvey {
  checkPathId(surveyId, "surveyId");
  const survey = data.surveys.find((candidate) => candidate.id === surveyId.toLowerCase());
  if (!survey?.published) throw surveyNotAvailable();
  return survey;
}

/** The non-empty string `cookieName` of a definition: "Limit to one response" (one-response.ts). */
const limitCookieOf = (definition: SandboxJson): string | null => {
  const { cookieName } = definition;
  return typeof cookieName === "string" && cookieName !== "" ? cookieName : null;
};

/** The definition the run page gets: `cookieName` = the survey id for the legacy setting (one-response.ts). */
function publishedDefinition(survey: SandboxSurvey, definition: SandboxJson): SandboxJson {
  if (!survey.settings.useCookies || limitCookieOf(definition) !== null) return definition;
  return { ...definition, cookieName: survey.id };
}

const alreadyCompleted = () =>
  new ProblemError({
    code: "already-completed",
    status: 409,
    title: "Already completed",
    detail:
      "This survey accepts one response per respondent, and this one has already completed it.",
  });

/** Submission order: `submittedAt` ascending (as instants), then id ascending (ordering.ts). */
export const responseOrder = (a: SandboxResponse, b: SandboxResponse): number =>
  Date.parse(a.submittedAt) - Date.parse(b.submittedAt) || compare(a.id, b.id);

/** After the position in `responseOrder` (ids compared lower-case): ordering.ts `isAfterResponse`. */
export function isAfterResponse(
  response: SandboxResponse,
  position: { submittedAt: string; id: string },
): boolean {
  const at = Date.parse(response.submittedAt);
  const after = Date.parse(position.submittedAt);
  return at > after || (at === after && response.id > position.id.toLowerCase());
}

/** The strict bounds of public results, as instants in milliseconds (`publicWindow`). */
export interface ResponseWindow {
  readonly from?: number;
  readonly till?: number;
}

const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}:\d{2}:\d{2}(?:\.\d+)?)([Zz]|[+-]\d{2}:\d{2})$/;

/** An RFC 3339 date-time as an instant in milliseconds; null when it is not one Date can read. */
function instantOf(value: string): number | null {
  const match = DATE_TIME.exec(value);
  if (!match) return null;
  const [, year, month, day, time, zone] = match;
  // A day the month does not have (Date would roll it over) is no date.
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  const at = Date.parse(`${year}-${month}-${day}T${time}${zone!.toUpperCase()}`);
  return Number.isNaN(at) ? null : at;
}

/**
 * `from` and `till` of public results as instants (server/src/results/service.ts `publicWindow`): a
 * value the contract's `date-time` accepts but Date cannot read (a leap second) is refused as any
 * other malformed date-time is.
 */
export function publicWindow(query: URLSearchParams): ResponseWindow {
  const window: { from?: number; till?: number } = {};
  const unreadable: ProblemFieldError[] = [];
  for (const name of ["from", "till"] as const) {
    const value = query.get(name);
    if (value === null) continue;
    const at = instantOf(value);
    if (at === null)
      unreadable.push({ pointer: `/${name}`, detail: 'must match format "date-time"' });
    else window[name] = at;
  }
  if (unreadable.length > 0) throw badRequest(undefined, unreadable);
  return window;
}

/**
 * A page of the survey's responses in `responseOrder`, and the cursor of the next one. Each run
 * reads as one response placed at its first row (ADR 0038); `completedOnly` leaves open runs out.
 */
export function responsePage(
  data: SandboxData,
  surveyId: string,
  limit: number,
  cursor: string | undefined,
  completedOnly = false,
  window: ResponseWindow = {},
): { items: SandboxResponse[]; nextCursor: string | null } {
  const after = cursor === undefined ? undefined : decodeResultsCursor(cursor, surveyId);
  const matching = foldRuns([...(data.responses[surveyId] ?? [])].sort(responseOrder))
    .map(responseOfRun)
    .filter((response) => after === undefined || isAfterResponse(response, after))
    .filter((response) => !completedOnly || !response.partial)
    .filter((response) => {
      const at = Date.parse(response.submittedAt);
      return (
        (window.from === undefined || at > window.from) &&
        (window.till === undefined || at < window.till)
      );
    });
  const items = matching.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      matching.length > items.length && last
        ? encodeResultsCursor({ submittedAt: last.submittedAt, id: last.id }, surveyId)
        : null,
  };
}

/** A survey of the store by its post or result ID; unknown: `survey-not-available`. */
function surveyByKey(
  data: SandboxData,
  field: "postId" | "resultId",
  value: string,
): SandboxSurvey {
  const survey = data.surveys.find((candidate) => candidate[field] === value.toLowerCase());
  if (!survey) throw surveyNotAvailable();
  return survey;
}

/** The contract's `PostId` and `ResultId` parameters: 1 to 200 characters. */
function checkKeyParam(value: string, name: string): void {
  if (value.length === 0 || [...value].length > 200) {
    throw badRequest(undefined, [
      {
        pointer: `/${name}`,
        detail:
          value.length === 0
            ? "must NOT have fewer than 1 characters"
            : "must NOT have more than 200 characters",
      },
    ]);
  }
}

function checkClientIdParam(value: string): void {
  const problem = clientIdProblem(value);
  if (problem) throw badRequest(undefined, [{ pointer: "/clientId", detail: problem }]);
}

/** The client's state from its marker; a marker without a partial flag reads `completed`. */
function respondentState(
  data: SandboxData,
  survey: SandboxSurvey,
  clientId: string,
): "none" | "partial" | "completed" {
  const marker = data.completions[survey.id]?.[clientId];
  if (marker === undefined) return "none";
  return marker.partial === true ? "partial" : "completed";
}

interface SubmitOptions {
  /** Checks the path before the headers and the body. */
  readonly before?: () => void;
  /** The survey the response goes to, at the write. */
  readonly find: (data: SandboxData) => SandboxSurvey;
  /** The run page's rule; off for the old service's post. */
  readonly limitToOneResponse: boolean;
}

/** Stores a response (service.ts `submit` and `submitByPostId`, one write). */
function submit(ctx: HandlerContext, request: Request, options: SubmitOptions): Promise<Response> {
  return guarded(async () => {
    options.before?.();
    const key = request.headers.get("idempotency-key");
    if (key !== null && (key.length < 1 || key.length > 128)) {
      throw badRequest(undefined, [
        {
          pointer: "/idempotency-key",
          detail:
            key.length < 1
              ? "must NOT have fewer than 1 characters"
              : "must NOT have more than 128 characters",
        },
      ]);
    }
    const body = requiredObject(await readJson(request));
    const errors: ProblemFieldError[] = [];
    if (!isRecord(body["data"])) {
      errors.push({
        pointer: "/data",
        detail: body["data"] === undefined ? "is required" : "must be object",
      });
    }
    const clientId = body["clientId"];
    if (clientId !== undefined) {
      if (typeof clientId !== "string") {
        errors.push({ pointer: "/clientId", detail: "must be string" });
      } else {
        const problem = clientIdProblem(clientId);
        if (problem) errors.push({ pointer: "/clientId", detail: problem });
      }
    }
    if (body["partial"] !== undefined && typeof body["partial"] !== "boolean") {
      errors.push({ pointer: "/partial", detail: "must be boolean" });
    }
    const page = body["lastPageIndex"];
    if (page !== undefined && (typeof page !== "number" || !Number.isInteger(page) || page < 0)) {
      errors.push({
        pointer: "/lastPageIndex",
        detail:
          typeof page === "number" && Number.isInteger(page) ? "must be >= 0" : "must be integer",
      });
    }
    if (errors.length > 0) throw validationFailed(errors);
    const answers = body["data"] as Record<string, unknown>;

    // One write: a replay, the one-response check and the new response see the same document.
    let result = "";
    await ctx.store.write((data) => {
      const survey = options.find(data);
      const keys = (data.idempotencyKeys[survey.id] ??= {});
      const known = key === null ? undefined : keys[key];
      // A retry of a stored response answers as the original did, even if the client has completed since.
      if (known !== undefined && data.responses[survey.id]?.some((r) => r.id === known)) {
        result = known;
        return;
      }
      if (typeof clientId === "string") {
        const limited =
          survey.settings.useCookies || limitCookieOf(data.definitions[survey.id] ?? {}) !== null;
        if (
          options.limitToOneResponse &&
          limited &&
          data.completions[survey.id]?.[clientId]?.partial === false
        ) {
          throw alreadyCompleted();
        }
      }
      const isPartial = typeof clientId === "string" && body["partial"] === true;
      const id = known ?? ctx.newId();
      if (key !== null) keys[key] = id;
      (data.responses[survey.id] ??= []).push({
        id,
        submittedAt: ctx.now().toISOString(),
        data: structuredClone(answers),
        ...(typeof clientId === "string" && { clientId }),
        partial: isPartial,
      });
      if (typeof clientId === "string") {
        (data.completions[survey.id] ??= {})[clientId] = { partial: isPartial };
      }
      result = id;
    });
    return HttpResponse.json({ id: result }, { status: 201 });
  });
}

export function publicHandlers(ctx: HandlerContext) {
  return [
    http.get("/public/surveys/{surveyId}", ({ params, request }) =>
      guarded(() => {
        const clientId = new URL(request.url).searchParams.get("clientId") ?? undefined;
        if (clientId !== undefined) {
          const problem = clientIdProblem(clientId);
          if (problem) throw badRequest(undefined, [{ pointer: "/clientId", detail: problem }]);
        }
        const data = ctx.store.read();
        const survey = availableSurvey(data, params.surveyId);
        const completed =
          clientId === undefined
            ? undefined
            : data.completions[survey.id]?.[clientId]?.partial === false;
        return HttpResponse.json({
          id: survey.id,
          name: survey.name,
          definition: publishedDefinition(survey, data.definitions[survey.id] ?? {}),
          theme: data.themes[survey.id] ?? {},
          ...(completed !== undefined && { completed }),
        });
      }),
    ),

    http.post("/public/surveys/{surveyId}/responses", ({ params, request }) =>
      submit(ctx, request, {
        find: (data) => availableSurvey(data, params.surveyId),
        limitToOneResponse: true,
      }),
    ),

    // The old service's checks (ADR 0039 point 5): the publish state and "Limit to one response"
    // are ignored, and the survey is found by its post ID.
    http.post("/public/posts/{postId}/responses", ({ params, request }) =>
      submit(ctx, request, {
        before: () => {
          requireHosted(ctx);
          checkKeyParam(params.postId, "postId");
        },
        find: (data) => surveyByKey(data, "postId", params.postId),
        limitToOneResponse: false,
      }),
    ),

    // The working definition of any survey, published or not, archived or not (service.ts
    // `getPublicDefinition`): its version is the editor's ETag, so a save changes it.
    http.get("/public/surveys/{surveyId}/definition", ({ params, request }) =>
      guarded(async () => {
        requireHosted(ctx);
        checkPathId(params.surveyId, "surveyId");
        const data = ctx.store.read();
        const survey = data.surveys.find(
          (candidate) => candidate.id === params.surveyId.toLowerCase(),
        );
        if (!survey) throw surveyNotAvailable();
        const definition = data.definitions[survey.id];
        const etag = formatEtag(await versionOf(definition));
        const headers = { ETag: etag, "Cache-Control": "no-cache" };
        const match = request.headers.get("if-none-match");
        if (match !== null && ifNoneMatchHits(match, etag.slice(1, -1))) {
          return new HttpResponse(null, { status: 304, headers });
        }
        return HttpResponse.json(definition ?? {}, { headers });
      }),
    ),

    http.get("/public/surveys/{surveyId}/respondents/{clientId}", ({ params }) =>
      guarded(() => {
        requireHosted(ctx);
        checkPathId(params.surveyId, "surveyId");
        checkClientIdParam(params.clientId);
        const data = ctx.store.read();
        const survey = data.surveys.find(
          (candidate) => candidate.id === params.surveyId.toLowerCase(),
        );
        if (!survey) throw surveyNotAvailable();
        return HttpResponse.json({ state: respondentState(data, survey, params.clientId) });
      }),
    ),

    http.get("/public/results/{resultId}/respondents/{clientId}", ({ params }) =>
      guarded(() => {
        requireHosted(ctx);
        checkKeyParam(params.resultId, "resultId");
        checkClientIdParam(params.clientId);
        const data = ctx.store.read();
        const survey = surveyByKey(data, "resultId", params.resultId);
        return HttpResponse.json({ state: respondentState(data, survey, params.clientId) });
      }),
    ),

    // One question's answers over the completed, folded responses (service.ts `questionSummary`).
    http.get("/public/results/{resultId}/questions/{name}", ({ params }) =>
      guarded(() => {
        requireHosted(ctx);
        checkKeyParam(params.resultId, "resultId");
        if (params.name.length === 0 || [...params.name].length > 256) {
          throw badRequest(undefined, [
            {
              pointer: "/name",
              detail:
                params.name.length === 0
                  ? "must NOT have fewer than 1 characters"
                  : "must NOT have more than 256 characters",
            },
          ]);
        }
        const data = ctx.store.read();
        const survey = surveyByKey(data, "resultId", params.resultId);
        const completed = foldRuns([...(data.responses[survey.id] ?? [])].sort(responseOrder))
          .map(responseOfRun)
          .filter((response) => !response.partial);
        const counts = summarizeQuestion(params.name, completed);
        // As the stats: the complete rows, which is one per completed response.
        const rows = (data.responses[survey.id] ?? [])
          .filter((row) => !row.partial)
          .sort(responseOrder);
        return HttpResponse.json({
          answered: counts.answered,
          values: counts.values,
          responseCount: rows.length,
          firstSubmittedAt: rows[0]?.submittedAt ?? null,
          lastSubmittedAt: rows.at(-1)?.submittedAt ?? null,
        });
      }),
    ),

    // Hosted only, and the sandbox is not hosted whatever its edition: not routed, so `404`.
    http.get("/public/surveys/{surveyId}/layouts/{kind}", () =>
      guarded(() => {
        throw notFound();
      }),
    ),

    http.get("/public/surveys/{surveyId}/results", ({ params, request }) =>
      guarded(() => {
        // The path, then the query: the server validates them in that order.
        checkPathId(params.surveyId, "surveyId");
        const url = new URL(request.url);
        const { limit, cursor } = parsePagingQuery(url, RESULTS_PAGE);
        // Before any lookup, as the validator refuses a malformed date-time.
        const window = publicWindow(url.searchParams);
        const data = ctx.store.read();
        const survey = data.surveys.find((s) => s.id === params.surveyId.toLowerCase());
        if (!survey?.settings.publicResults) throw surveyNotAvailable();
        const { items, nextCursor } = responsePage(data, survey.id, limit, cursor, true, window);
        const definition = data.definitions[survey.id] ?? {};
        const privateQuestions = data.privateResultQuestions[survey.id] ?? [];
        const hidden = privateKeysOf(definition, privateQuestions);
        return HttpResponse.json(
          {
            survey: {
              id: survey.id,
              name: survey.name,
              definition,
              privateQuestions: [...privateQuestions],
            },
            items: items.map((response) => ({
              submittedAt: response.submittedAt,
              data: withoutKeys(response.data, hidden),
            })),
            nextCursor,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }),
    ),
  ];
}
