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
import type { HandlerContext } from "./context";
import { privateKeysOf, withoutKeys } from "./definition";
import { http } from "./http";
import { decodeResultsCursor, encodeResultsCursor } from "./paging";
import {
  badRequest,
  guarded,
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

/** A page of the survey's responses in `responseOrder`, and the cursor of the next one. */
export function responsePage(
  data: SandboxData,
  surveyId: string,
  limit: number,
  cursor: string | undefined,
): { items: SandboxResponse[]; nextCursor: string | null } {
  const after = cursor === undefined ? undefined : decodeResultsCursor(cursor, surveyId);
  const matching = [...(data.responses[surveyId] ?? [])]
    .sort(responseOrder)
    .filter((response) => after === undefined || isAfterResponse(response, after));
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
      guarded(async () => {
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
        if (
          page !== undefined &&
          (typeof page !== "number" || !Number.isInteger(page) || page < 0)
        ) {
          errors.push({
            pointer: "/lastPageIndex",
            detail:
              typeof page === "number" && Number.isInteger(page)
                ? "must be >= 0"
                : "must be integer",
          });
        }
        if (errors.length > 0) throw validationFailed(errors);
        const answers = body["data"] as Record<string, unknown>;

        // One write: a replay, the one-response check and the new response see the same document.
        let result = "";
        ctx.store.write((data) => {
          const survey = availableSurvey(data, params.surveyId);
          const keys = (data.idempotencyKeys[survey.id] ??= {});
          const known = key === null ? undefined : keys[key];
          // A retry of a stored response answers as the original did, even if the client has completed since.
          if (known !== undefined && data.responses[survey.id]?.some((r) => r.id === known)) {
            result = known;
            return;
          }
          if (typeof clientId === "string") {
            const limited =
              survey.settings.useCookies ||
              limitCookieOf(data.definitions[survey.id] ?? {}) !== null;
            if (limited && data.completions[survey.id]?.[clientId]?.partial === false) {
              throw alreadyCompleted();
            }
          }
          const id = known ?? ctx.newId();
          if (key !== null) keys[key] = id;
          (data.responses[survey.id] ??= []).push({
            id,
            submittedAt: ctx.now().toISOString(),
            data: structuredClone(answers),
            ...(typeof clientId === "string" && { clientId }),
            partial: false,
          });
          if (typeof clientId === "string") {
            (data.completions[survey.id] ??= {})[clientId] = { partial: false };
          }
          result = id;
        });
        return HttpResponse.json({ id: result }, { status: 201 });
      }),
    ),

    http.get("/public/surveys/{surveyId}/results", ({ params, request }) =>
      guarded(() => {
        // The path, then the query: the server validates them in that order.
        checkPathId(params.surveyId, "surveyId");
        const { limit, cursor } = parsePagingQuery(new URL(request.url), RESULTS_PAGE);
        const data = ctx.store.read();
        const survey = data.surveys.find((s) => s.id === params.surveyId.toLowerCase());
        if (!survey?.settings.publicResults) throw surveyNotAvailable();
        const { items, nextCursor } = responsePage(data, survey.id, limit, cursor);
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
