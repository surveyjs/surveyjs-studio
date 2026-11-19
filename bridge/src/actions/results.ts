// The old API's results reads (reference behaviour: ADR 0039): `getResult`, one question's counts
// through Studio's `getQuestionSummary`, and `getSurveyPublicResults`, every public result through
// Studio's `getPublicResults`, paged to the end and streamed as the pages come.
import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { jsonContentType, sendJsonString, sendProblem } from "../answers.js";
import { EMPTY_GUID, guidParameter, parseGuid } from "../binding.js";
import {
  JsonNumber,
  oldJson,
  oldTime,
  parseDateArgument,
  parseStudioJson,
  questionResultEntries,
} from "../dotnet-format.js";
import { oldRoute, queryValue } from "../routes.js";
import { StudioFailure, unexpectedStatus } from "../studio.js";

/** The old `getResult`'s response header (its answers, refusals included, but not its errors). */
const CACHE_CONTROL = "private, max-age=3600, must-revalidate";
const CHECK_PARAMETERS = "Check parameter values.";

/** The longest question name Studio takes, in characters (the contract's limit). */
const MAX_QUESTION_NAME = 256;
/**
 * The name asked for when the real one cannot reach Studio (longer than Studio takes, or a dot
 * segment a URL cannot carry). The old API answered such a name as a question without answers,
 * with the survey's totals; those totals are the same whatever name is asked for, so the bridge
 * asks for this one and uses only them. Studio's request logs show these calls as
 * `…/questions/_`.
 */
const STAND_IN_NAME = "_";

/** Whether Studio can be asked about `name`: at most 256 characters, not a dot segment. */
function isSendableName(name: string): boolean {
  if (name === "." || name === "..") return false;
  // Characters as code points, as the contract counts them; at most two UTF-16 units each.
  if (name.length <= MAX_QUESTION_NAME) return true;
  return name.length <= 2 * MAX_QUESTION_NAME && [...name].length <= MAX_QUESTION_NAME;
}

function count(value: unknown): number {
  const number = value instanceof JsonNumber ? Number(value.text) : Number.NaN;
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Studio sent no count");
  return number;
}

function time(value: unknown): string | null {
  if (value === null || typeof value === "string") return value;
  throw new Error("Studio sent no time");
}

/** Studio's `QuestionSummary`, its numbers with their text. */
function readSummary(text: string) {
  const summary = parseStudioJson(text) as Record<string, unknown> | null;
  const values = summary?.values;
  if (!Array.isArray(values)) throw new Error("Studio sent no question summary");
  return {
    answered: count(summary!.answered),
    values: values as { value: unknown; count: JsonNumber }[],
    responseCount: count(summary!.responseCount),
    first: time(summary!.firstSubmittedAt),
    last: time(summary!.lastSubmittedAt),
  };
}

function sendGetResult(reply: FastifyReply, status: 200 | 400, body: string): FastifyReply {
  return reply
    .code(status)
    .header("cache-control", CACHE_CONTROL)
    .header("content-type", jsonContentType(reply.request.headers.accept))
    .send(body);
}

async function getResult(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const resultId = guidParameter(request, reply, "resultId");
  if (resultId === undefined) return reply;
  const name = queryValue(request, "name");
  if (name === undefined || name === "") {
    return sendProblem(reply.header("cache-control", CACHE_CONTROL), 400);
  }
  const unknown = JSON.stringify(CHECK_PARAMETERS);
  if (resultId === EMPTY_GUID) return sendGetResult(reply, 400, unknown);

  const sendable = isSendableName(name);
  const { data, response } = await request.studio.GET(
    "/public/results/{resultId}/questions/{name}",
    { params: { path: { resultId, name: sendable ? name : STAND_IN_NAME } }, parseAs: "text" },
  );
  if (response.status === 404) return sendGetResult(reply, 400, unknown);
  if (response.status !== 200 || data === undefined) return unexpectedStatus(response);
  const summary = readSummary(data);
  // A name Studio cannot hold is no question's: no answers, the survey's totals.
  const entries = sendable ? questionResultEntries(summary.values) : [];
  const questionResult = entries.map(([key, n]) => `${JSON.stringify(key)}:${n}`).join(",");
  return sendGetResult(
    reply,
    200,
    `{"AnswersCount":${sendable ? summary.answered : 0},"QuestionResult":{${questionResult}},` +
      `"FirstResultAt":${JSON.stringify(oldTime(summary.first, false))},` +
      `"LastResultAt":${JSON.stringify(oldTime(summary.last, false))},` +
      `"ResultCount":${summary.responseCount}}`,
  );
}

interface ResultPage {
  privateQuestions: readonly string[];
  items: { submittedAt: string; data: Record<string, unknown> }[];
  nextCursor: string | null;
}

/** Studio's `PublicResultPage`, its numbers with their text. */
function readPage(text: string): ResultPage {
  const page = parseStudioJson(text) as Record<string, unknown> | null;
  const items = page?.items;
  const nextCursor = page?.nextCursor;
  if (!Array.isArray(items) || (nextCursor !== null && typeof nextCursor !== "string")) {
    throw new Error("Studio sent no page of results");
  }
  const survey = page!.survey as { privateQuestions?: unknown } | undefined;
  const privateQuestions = Array.isArray(survey?.privateQuestions)
    ? (survey.privateQuestions as unknown[]).filter((name) => typeof name === "string")
    : [];
  return { privateQuestions, items: items as ResultPage["items"], nextCursor };
}

/**
 * One result as the old public results wrote it: the answers, then `HappendAt` (the time it was
 * submitted) and `InstanceId` (`null` in public results), each over an answer of its name in that
 * answer's place, and left out when the survey's private questions name it. Never `ClientId` or
 * `IPAddress` (ADR 0039 point 1).
 */
function resultRow(item: ResultPage["items"][number], hidden: ReadonlySet<string>): string {
  const row: Record<string, unknown> = { ...item.data };
  row.HappendAt = oldTime(item.submittedAt, true);
  row.InstanceId = null;
  for (const name of ["HappendAt", "InstanceId"]) if (hidden.has(name)) delete row[name];
  return oldJson(row);
}

/** The wait for a later page without a `Retry-After`, and the longest one (seconds). */
const DEFAULT_RETRY_WAIT_S = 60;
const MAX_RETRY_WAIT_S = 120;

/**
 * How long to wait before reading a page again after Studio's `429`: its `Retry-After` (seconds,
 * or an HTTP date), 60 s without one, at most 120 s.
 */
export function retryDelayMs(retryAfter: string | null, now = Date.now()): number {
  let seconds = DEFAULT_RETRY_WAIT_S;
  const text = retryAfter?.trim() ?? "";
  if (/^[0-9]+$/.test(text)) seconds = Number(text);
  else if (text !== "") {
    const at = Date.parse(text);
    if (!Number.isNaN(at)) seconds = Math.max(0, (at - now) / 1000);
  }
  return Math.min(seconds, MAX_RETRY_WAIT_S) * 1000;
}

/** The largest page Studio gives. */
const PAGE_LIMIT = 1000;

async function getSurveyPublicResults(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  // The route's ID wins over the query's; anything that is no GUID binds as the zero GUID.
  const { id } = request.params as { id?: string };
  const idText = id ?? queryValue(request, "id");
  const surveyId = (idText === undefined ? null : parseGuid(idText)) ?? EMPTY_GUID;
  const refusal = `You are not authorized to get results of the survey ${surveyId}`;
  if (surveyId === EMPTY_GUID) return sendJsonString(reply, 400, refusal);

  // A malformed bound is no bound, as the old API ignored it.
  const from = parseDateArgument(queryValue(request, "from") ?? "");
  const till = parseDateArgument(queryValue(request, "till") ?? "");
  const fetchPage = (cursor: string | undefined) =>
    request.studio.GET("/public/surveys/{surveyId}/results", {
      params: {
        path: { surveyId },
        query: {
          limit: PAGE_LIMIT,
          ...(cursor !== undefined && { cursor }),
          ...(from !== undefined && { from }),
          ...(till !== undefined && { till }),
        },
      },
      parseAs: "text",
    });

  const first = await fetchPage(undefined);
  // Unknown, or its results are not public: the old refusal.
  if (first.response.status === 404) return sendJsonString(reply, 400, refusal);
  if (first.response.status !== 200 || first.data === undefined) {
    return unexpectedStatus(first.response);
  }
  const firstPage = readPage(first.data);
  const hidden = new Set(firstPage.privateQuestions);

  /**
   * A page after the first. The answer has started, so Studio's rate limit (`429`) can no longer
   * be passed on: the bridge waits as Studio asks and reads the page again, for as long as the
   * caller stays; when the caller leaves, the wait ends and nothing more is read.
   */
  async function laterPage(cursor: string): Promise<ResultPage> {
    for (;;) {
      request.callerGone.throwIfAborted();
      try {
        const next = await fetchPage(cursor);
        if (next.response.status !== 200 || next.data === undefined) {
          return unexpectedStatus(next.response);
        }
        return readPage(next.data);
      } catch (error) {
        if (!(error instanceof StudioFailure) || error.status !== 429) throw error;
        const waitMs = retryDelayMs(error.retryAfter);
        request.log.info({ surveyId, waitMs }, "public results: Studio's rate limit, waiting");
        await sleep(waitMs, undefined, { signal: request.callerGone });
      }
    }
  }

  // Streamed as Studio's pages come: one page at a time in memory. A page that fails after the
  // answer has started cuts it off, as the old API's failures mid-stream did.
  async function* body(): AsyncGenerator<string> {
    yield '{"Data":[';
    let written = 0;
    let page = firstPage;
    for (;;) {
      if (page.items.length > 0) {
        const rows = page.items.map((item) => resultRow(item, hidden)).join(",");
        yield written > 0 ? `,${rows}` : rows;
        written += page.items.length;
      }
      if (page.nextCursor === null) break;
      page = await laterPage(page.nextCursor);
    }
    yield `],"ResultCount":${written}}`;
  }

  return reply
    .code(200)
    .header("content-type", "application/json; charset=utf-8")
    .send(Readable.from(body(), { objectMode: false }));
}

export function registerResultActions(app: FastifyInstance): void {
  oldRoute(app, ["GET"], ["getResult"], getResult);
  oldRoute(
    app,
    ["GET"],
    ["getSurveyPublicResults", "getSurveyPublicResults/:id"],
    getSurveyPublicResults,
    { controller: "private" },
  );
}
