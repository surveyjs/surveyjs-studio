// The old API's survey reads (reference behaviour: ADR 0039): `getSurvey`, `getSurveyAndIsCompleted`
// and `isCompleted`, through Studio's `getPublicDefinition`, `getRespondentState` and
// `getRespondentStateByResultId`.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { sendEmpty, sendJsonString, jsonContentType } from "../answers.js";
import { EMPTY_GUID, guidParameter, isStudioClientId } from "../binding.js";
import { oldRoute, queryValue } from "../routes.js";
import { StudioFailure, unexpectedStatus } from "../studio.js";
import type { SurveyCache } from "../survey-cache.js";

const CHECK_PARAMETERS = "Check parameter values.";

type OldState = "no" | "partial" | "completed";

const OLD_STATES: Record<"none" | "partial" | "completed", OldState> = {
  none: "no",
  partial: "partial",
  completed: "completed",
};

/**
 * The survey's definition as JSON text, from the cache when Studio confirms it unchanged or
 * refuses the revalidation for rate reasons (`429`: a busy caller keeps its answer); `undefined`
 * when Studio has no such survey.
 */
async function definitionText(
  request: FastifyRequest,
  cache: SurveyCache,
  surveyId: string,
): Promise<string | undefined> {
  if (surveyId === EMPTY_GUID) return undefined;
  const cached = cache.get(surveyId);
  let read;
  try {
    read = await request.studio.GET("/public/surveys/{surveyId}/definition", {
      params: {
        path: { surveyId },
        ...(cached !== undefined && { header: { "If-None-Match": cached.etag } }),
      },
    });
  } catch (error) {
    if (error instanceof StudioFailure && error.status === 429 && cached !== undefined) {
      return cached.body;
    }
    throw error;
  }
  const { data, response } = read;
  if (response.status === 304 && cached !== undefined) return cached.body;
  if (response.status === 404) {
    cache.delete(surveyId);
    return undefined;
  }
  if (response.status !== 200 || data === undefined) return unexpectedStatus(response);
  const body = JSON.stringify(data);
  const etag = response.headers.get("etag");
  if (etag === null || etag === "") cache.delete(surveyId);
  else cache.set(surveyId, { etag, body });
  return body;
}

/** A respondent's state in the old API's words: an unknown survey or client is `"no"`. */
async function respondentState(
  request: FastifyRequest,
  key: { surveyId: string } | { resultId: string },
  clientId: string,
): Promise<OldState> {
  const id = "surveyId" in key ? key.surveyId : key.resultId;
  // `.` and `..` are dot segments: a URL cannot carry them to Studio as a client ID.
  if (id === EMPTY_GUID || !isStudioClientId(clientId) || clientId === "." || clientId === "..") {
    return "no";
  }
  const { data, response } =
    "surveyId" in key
      ? await request.studio.GET("/public/surveys/{surveyId}/respondents/{clientId}", {
          params: { path: { surveyId: key.surveyId, clientId } },
        })
      : await request.studio.GET("/public/results/{resultId}/respondents/{clientId}", {
          params: { path: { resultId: key.resultId, clientId } },
        });
  if (data !== undefined) return OLD_STATES[data.state];
  if (response.status === 404 || response.status === 400) return "no";
  return unexpectedStatus(response);
}

export function registerSurveyActions(app: FastifyInstance, cache: SurveyCache): void {
  oldRoute(app, ["GET"], ["getSurvey"], async (request, reply) => {
    const surveyId = guidParameter(request, reply, "surveyId");
    if (surveyId === undefined) return reply;
    const body = await definitionText(request, cache, surveyId);
    if (body === undefined) return sendJsonString(reply, 400, CHECK_PARAMETERS);
    // The old API sent the stored text with this fixed type, without a charset (a Buffer, so
    // Fastify adds none).
    return reply.code(200).header("content-type", "application/json").send(Buffer.from(body));
  });

  oldRoute(app, ["GET"], ["getSurveyAndIsCompleted"], async (request, reply) => {
    const surveyId = guidParameter(request, reply, "surveyId");
    if (surveyId === undefined) return reply;
    const clientId = queryValue(request, "clientId") ?? "";
    if (clientId === "") return sendJsonString(reply, 400, "Check 'clientId' parameter");
    // Both reads at once; when both fail, the state read's failure answers, as it came first.
    const [state, definition] = await Promise.allSettled([
      respondentState(request, { surveyId }, clientId),
      definitionText(request, cache, surveyId),
    ]);
    if (state.status === "rejected") throw state.reason;
    if (definition.status === "rejected") throw definition.reason;
    const isCompleted = state.value;
    const survey = definition.value;
    if (survey === undefined) return sendJsonString(reply, 400, CHECK_PARAMETERS);
    // The old API parsed the definition as a JSON object and failed on anything else.
    if (!survey.startsWith("{")) return sendEmpty(reply, 500);
    return reply
      .code(200)
      .header("content-type", jsonContentType(request.headers.accept))
      .send(`{"survey":${survey},"isCompleted":${JSON.stringify(isCompleted)}}`);
  });

  oldRoute(app, ["GET"], ["isCompleted"], async (request, reply) => {
    const resultId = guidParameter(request, reply, "resultId");
    if (resultId === undefined) return reply;
    // ADR 0039 point 1: without a client ID the old API answered another respondent's state.
    const clientId = queryValue(request, "clientId") ?? "";
    const state = clientId === "" ? "no" : await respondentState(request, { resultId }, clientId);
    return sendJsonString(reply, 200, state);
  });
}
