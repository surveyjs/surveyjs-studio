// The old API's response actions (reference behaviour: ADR 0040): reading every response
// (`getSurveyResults`, streamed or paged with the bridge's own tokens, tokens.ts), the first 1,000
// (`getSurveyDemoResults`), exporting them as CSV or JSON (`exportSurveyResults`), and deleting one
// or all, through Studio's `listResults`, `deleteResponse` and `deleteResults` with the caller's
// key. Studio folds a client's saves into runs (ADR 0038): each run is one row, and its
// `InstanceId` is the run's ID. Studio's permissions apply (ADR 0009); a survey Studio does not
// show the caller (`404`) or does not let them change (`403`) gets the action's old "You are not
// authorized …" answer. Whole-survey reads walk Studio's pages and wait out its rate limit
// (results.ts).
import type { FastifyReply, FastifyRequest } from "fastify";
import { sendEmpty, sendJsonString, sendJsonText } from "../answers.js";
import { boundGuid, boundValue } from "../binding.js";
import { calculateColumns, ColumnsRefused, newestFirst } from "../columns.js";
import { contextOf } from "../context.js";
import {
  contentDisposition,
  oldJson,
  oldTime,
  parseDateArgument,
  parseOldDate,
  parseStudioJson,
} from "../dotnet-format.js";
import { csvExport } from "../export-csv.js";
import { studioFor } from "../key.js";
import { queryValue } from "../routes.js";
import { StudioFailure, unexpectedStatus, type StudioClient } from "../studio.js";
import { decodeToken, encodeToken } from "../tokens.js";
import { pagesFrom, patiently, sendStreamedRows } from "./results.js";

const GET_RESULTS = "You are not authorized to get results of the survey";
const MODIFY = "You are not authorized to modify the survey";

/** The largest page Studio gives, the old API's largest page, and the old demo's cap. */
export const PAGE_LIMIT = 1000;

const rawJson = (JSON as unknown as { rawJSON(text: string): unknown }).rawJSON;

function studio(request: FastifyRequest): StudioClient {
  return studioFor(request, contextOf(request).settings);
}

/** Studio does not show the survey to the caller, or does not let them change it. */
const isRefusal = (status: number) => status === 403 || status === 404;

function notAuthorized(reply: FastifyReply, message: string, id: string): FastifyReply {
  return sendJsonString(reply, 400, `${message} ${id}`);
}

/** A response as `listResults` gives it, its answers' numbers with their text. */
export interface StudioResponse {
  id: string;
  submittedAt: string;
  data: Record<string, unknown>;
  clientId?: string;
  respondentIp?: string;
}

export interface ResponsePage {
  items: StudioResponse[];
  nextCursor: string | null;
}

/** Studio's `ResponsePage`. */
function readResponsePage(text: string): ResponsePage {
  const page = parseStudioJson(text) as Record<string, unknown> | null;
  const items = page?.items;
  const nextCursor = page?.nextCursor;
  if (!Array.isArray(items) || (nextCursor !== null && typeof nextCursor !== "string")) {
    throw new Error("Studio sent no page of responses");
  }
  return { items: items as StudioResponse[], nextCursor };
}

/**
 * One page of the survey's responses from `cursor` (none: the first), at most `limit`:
 * `refused` when Studio does not show the survey, `bad-cursor` when it refuses the cursor.
 */
export type PageReader = (
  cursor: string | undefined,
  limit: number,
) => Promise<ResponsePage | "refused" | "bad-cursor">;

export function pageReader(
  client: StudioClient,
  surveyId: string,
  bounds: { from?: string | undefined; till?: string | undefined } = {},
): PageReader {
  return async (cursor, limit) => {
    const { data, response } = await client.GET("/surveys/{surveyId}/results", {
      params: {
        path: { surveyId },
        query: {
          limit,
          ...(cursor !== undefined && { cursor }),
          ...(bounds.from !== undefined && { from: bounds.from }),
          ...(bounds.till !== undefined && { till: bounds.till }),
        },
      },
      parseAs: "text",
    });
    if (response.status === 200 && data !== undefined) return readResponsePage(data);
    if (isRefusal(response.status)) return "refused";
    if (response.status === 400 && cursor !== undefined) return "bad-cursor";
    return unexpectedStatus(response);
  };
}

/** A page after the first of a walk: only a page. */
function laterPage(read: PageReader) {
  return async (cursor: string, limit = PAGE_LIMIT): Promise<ResponsePage> => {
    const page = await read(cursor, limit);
    if (typeof page === "string") {
      throw new StudioFailure(500, `Studio answered a later page of responses: ${page}`);
    }
    return page;
  };
}

/** Every response from the first page `first` on, the later pages waiting out Studio's `429`. */
export function allPages(
  request: FastifyRequest,
  read: PageReader,
  first: ResponsePage,
  surveyId: string,
): AsyncGenerator<ResponsePage> {
  const next = laterPage(read);
  return pagesFrom(request, first, (cursor) => next(cursor), { surveyId, read: "responses" });
}

/** Every response of the survey, oldest first; `refused` when Studio does not show it. */
async function everyResponse(
  request: FastifyRequest,
  read: PageReader,
  surveyId: string,
): Promise<StudioResponse[] | "refused"> {
  const first = await read(undefined, PAGE_LIMIT);
  // Only a cursor can be refused.
  if (first === "refused" || first === "bad-cursor") return "refused";
  const responses: StudioResponse[] = [];
  for await (const page of allPages(request, read, first, surveyId)) responses.push(...page.items);
  return responses;
}

/**
 * One response as the old results wrote it: the answers, then `HappendAt` (the time it was
 * submitted), `IPAddress` and `ClientId` when Studio holds them, and `InstanceId` (the run's ID,
 * or `null` for the public export), each over an answer of its name in that answer's place; less
 * the `hidden` keys.
 */
function responseRow(
  item: StudioResponse,
  instanceId: boolean,
  hidden: ReadonlySet<string> = new Set(),
): string {
  const row: Record<string, unknown> = { ...item.data };
  row.HappendAt = oldTime(item.submittedAt, true);
  // Texts the old API held as texts, never as dates.
  if (item.respondentIp !== undefined) row.IPAddress = rawJson(JSON.stringify(item.respondentIp));
  if (item.clientId !== undefined) row.ClientId = rawJson(JSON.stringify(item.clientId));
  row.InstanceId = instanceId ? item.id : null;
  for (const key of Object.keys(row)) if (hidden.has(key)) delete row[key];
  return oldJson(row);
}

/** The old `int?` binding: decimal (or `0x`/`&h`/`#` hex) in the integer's range; else none. */
function boundInt(text: string | undefined): number | undefined {
  const trimmed = text?.trim() ?? "";
  const hex = /^(?:0x|&h|#)([0-9a-f]{1,8})$/i.exec(trimmed);
  if (hex !== null) {
    const value = Number.parseInt(hex[1]!, 16);
    return value >= 2 ** 31 ? value - 2 ** 32 : value;
  }
  if (!/^[+-]?[0-9]+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= -(2 ** 31) && value < 2 ** 31 ? value : undefined;
}

/** `from` and `till` as the old API bound them: a malformed one is no bound. */
async function boundsOf(request: FastifyRequest) {
  return {
    from: parseDateArgument((await boundValue(request, "from")) ?? ""),
    till: parseDateArgument((await boundValue(request, "till")) ?? ""),
  };
}

/**
 * One page of `size` rows from the place `start` names: the rows, and the token of the place after
 * them while more rows follow (else `null`). The pages Studio is asked for hold just what the walk
 * still needs. A cursor Studio refuses starts again at the first row, as the old offset engine did
 * with a token it could not read.
 */
async function readPage(
  request: FastifyRequest,
  read: PageReader,
  start: { cursor?: string; offset: number },
  size: number,
  surveyId: string,
): Promise<{ rows: StudioResponse[]; token: string | null } | "refused"> {
  const limitFor = (wanted: number) => Math.min(Math.max(wanted, 1), PAGE_LIMIT);
  let cursor = start.cursor;
  let skip = start.offset;
  let first = await read(cursor, limitFor(skip + size));
  if (first === "bad-cursor") {
    cursor = undefined;
    skip = 0;
    first = await read(undefined, limitFor(size));
  }
  if (first === "refused" || first === "bad-cursor") return "refused";
  const next = laterPage(read);
  let page = first;
  const rows: StudioResponse[] = [];
  for (;;) {
    const { items } = page;
    if (skip < items.length) {
      const taken = items.slice(skip, skip + size - rows.length);
      rows.push(...taken);
      skip += taken.length;
    }
    if (rows.length === size && skip < items.length) {
      return { rows, token: encodeToken(cursor ?? "", skip) };
    }
    const nextCursor = page.nextCursor;
    if (nextCursor === null) return { rows, token: null };
    if (rows.length === size) return { rows, token: encodeToken(nextCursor, 0) };
    skip -= items.length;
    cursor = nextCursor;
    const limit = limitFor(skip + size - rows.length);
    page = await patiently(request, () => next(nextCursor, limit), { surveyId, read: "responses" });
  }
}

/**
 * `getSurveyResults`: every response the caller can see the survey's results of, with full rows.
 * With `take` or a `continuationToken`, one page of `take` rows (1 to 1,000; 1,000 without) and
 * the token of the next; otherwise all of them, streamed. `from`/`till` bound the time of the
 * first save.
 */
export async function getSurveyResults(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const surveyId = await boundGuid(request, "id");
  const read = pageReader(studio(request), surveyId, await boundsOf(request));
  const take = boundInt(await boundValue(request, "take"));
  const token = (await boundValue(request, "continuationToken")) ?? "";

  if (take !== undefined || token !== "") {
    const size = Math.min(Math.max(take ?? PAGE_LIMIT, 1), PAGE_LIMIT);
    const page = await readPage(request, read, decodeToken(token), size, surveyId);
    if (page === "refused") return notAuthorized(reply, GET_RESULTS, surveyId);
    const rows = page.rows.map((item) => responseRow(item, true)).join(",");
    return sendJsonText(
      reply,
      200,
      `{"ContinuationToken":${JSON.stringify(page.token)},"ResultCount":${page.rows.length},` +
        `"Data":[${rows}]}`,
    );
  }

  const first = await read(undefined, PAGE_LIMIT);
  if (first === "refused" || first === "bad-cursor") {
    return notAuthorized(reply, GET_RESULTS, surveyId);
  }
  // Streamed as Studio's pages come; a page that fails after the answer has started cuts it off.
  const pages = allPages(request, read, first, surveyId);
  return sendStreamedRows(reply, pages, (item) => responseRow(item, true));
}

/** A time as the old platform's ticks, to compare times finer than milliseconds. */
function ticksOf(text: string): bigint {
  const date = parseOldDate(text);
  if (date === null) throw new Error("a time the bridge cannot read");
  return BigInt(date.ms) * 10_000n + BigInt(date.fraction);
}

/**
 * `getSurveyDemoResults`: the first 1,000 responses in Studio's order, with full rows, and of
 * those the ones `from`/`till` let through (the old API cut before it filtered).
 */
export async function getSurveyDemoResults(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const surveyId = await boundGuid(request, "id");
  const { from, till } = await boundsOf(request);
  const page = await pageReader(studio(request), surveyId)(undefined, PAGE_LIMIT);
  if (page === "refused" || page === "bad-cursor") {
    return notAuthorized(reply, GET_RESULTS, surveyId);
  }
  const after = from === undefined ? undefined : ticksOf(from);
  const before = till === undefined ? undefined : ticksOf(till);
  const rows = page.items.filter((item) => {
    const at = ticksOf(item.submittedAt);
    return (after === undefined || at > after) && (before === undefined || at < before);
  });
  const data = rows.map((item) => responseRow(item, true)).join(",");
  return sendJsonText(reply, 200, `{"ResultCount":${rows.length},"Data":[${data}]}`);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The answer keys of the questions a definition holds, by question name: `valueName` when set,
 * else the name. Pages in order (the root as one page without pages), panels flattened, elements
 * without a value (`html`, `image`) skipped; Studio's rule for public results.
 */
function answerKeys(definition: Record<string, unknown>): Map<string, string> {
  const keys = new Map<string, string>();
  const pending: unknown[] = [];
  const pushElements = (container: Record<string, unknown>) => {
    const elements = [
      ...(Array.isArray(container.elements) ? container.elements : []),
      ...(Array.isArray(container.questions) ? container.questions : []),
    ];
    for (let index = elements.length - 1; index >= 0; index -= 1) pending.push(elements[index]);
  };
  const pages = Array.isArray(definition.pages) ? definition.pages : [definition];
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const page = pages[index];
    if (isRecord(page))
      pending.push({ type: "panel", elements: page.elements, questions: page.questions });
  }
  while (pending.length > 0) {
    const element = pending.pop();
    if (!isRecord(element)) continue;
    const type = typeof element.type === "string" ? element.type.toLowerCase() : "";
    if (type === "panel") {
      pushElements(element);
      continue;
    }
    const { name, valueName } = element;
    if (typeof name !== "string" || name === "" || type === "html" || type === "image") continue;
    if (keys.has(name)) continue;
    keys.set(name, typeof valueName === "string" && valueName !== "" ? valueName : name);
  }
  return keys;
}

/**
 * The row keys the public column filter leaves out for these private questions, as Studio's
 * public results do: each name and its question's answer key, each without and with a comment
 * suffix (the survey's `commentSuffix` or `commentPrefix`, and the library's `-Comment`).
 */
function privateKeys(definition: unknown, names: readonly string[]): Set<string> {
  if (names.length === 0 || !isRecord(definition)) return new Set(names);
  const hidden = new Set<string>();
  const suffixes = new Set(["-Comment"]);
  for (const property of ["commentSuffix", "commentPrefix"]) {
    const value = definition[property];
    if (typeof value === "string" && value !== "") suffixes.add(value);
  }
  const keys = answerKeys(definition);
  for (const name of names) {
    for (const key of [name, keys.get(name) ?? name]) {
      hidden.add(key);
      for (const suffix of suffixes) hidden.add(key + suffix);
    }
  }
  return hidden;
}

/**
 * `exportSurveyResults`: every response as a file named after the survey. `format` exactly `csv`:
 * the old CSV (every column, newest first, titles in `localeName`'s language, export-csv.ts);
 * anything else: JSON `{ ResultCount, Data }` with the public column filter (the private questions
 * left out) and no `InstanceId`. `from`/`till` are ignored, as the old export ignored them.
 */
export async function exportSurveyResults(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const client = studio(request);
  const surveyId = await boundGuid(request, "id");
  const csv = queryValue(request, "format") === "csv";
  // The old default is `en`; an empty value bound as none, which matches no language.
  const localeName = queryValue(request, "localeName");
  const locale = localeName === undefined ? "en" : localeName === "" ? null : localeName;
  const refusal = () => notAuthorized(reply, GET_RESULTS, surveyId);
  const path = { params: { path: { surveyId } } };

  const read = await client.GET("/surveys/{surveyId}", path);
  if (isRefusal(read.response.status)) return refusal();
  if (read.data === undefined) return unexpectedStatus(read.response);
  const survey = read.data;
  const privateQuestions = survey.settings.privateResultQuestions;
  const needsDefinition = csv || (privateQuestions !== undefined && privateQuestions.length > 0);

  const [definition, layout] = await Promise.all([
    needsDefinition
      ? client.GET("/surveys/{surveyId}/definition", { ...path, parseAs: "text" })
      : undefined,
    csv
      ? client.GET("/surveys/{surveyId}/layouts/{kind}", {
          params: { path: { surveyId, kind: "columns" } },
        })
      : undefined,
  ]);
  let definitionValue: unknown;
  if (definition !== undefined) {
    if (isRefusal(definition.response.status)) return refusal();
    if (definition.data === undefined) return unexpectedStatus(definition.response);
    definitionValue = parseStudioJson(definition.data);
  }
  const responses = await everyResponse(request, pageReader(client, surveyId), surveyId);
  if (responses === "refused") return refusal();

  let body: Buffer;
  if (csv) {
    const { data, error, response } = layout!;
    // No shared layout saved: none to merge.
    const noLayout = response.status === 404 && error?.code === "layout-not-found";
    if (data === undefined && !noLayout) {
      return isRefusal(response.status) ? refusal() : unexpectedStatus(response);
    }
    const columnsLayout = data?.text ?? null;
    const rows = newestFirst(responses);
    try {
      const columns = calculateColumns({
        definition: definitionValue,
        rows,
        columnsLayout,
        privateQuestions: privateQuestions ?? [],
        locale,
        storeIp: survey.settings.storeRespondentIp === true,
      });
      body = csvExport(columns, rows);
    } catch (error) {
      if (error instanceof ColumnsRefused) return sendEmpty(reply, 400);
      throw error;
    }
  } else {
    // Without the private questions the bridge cannot tell what to leave out.
    if (privateQuestions === undefined) {
      throw new StudioFailure(500, "Studio could not read the private questions");
    }
    const hidden = privateKeys(definitionValue, privateQuestions);
    const rows = responses.map((item) => responseRow(item, false, hidden)).join(",");
    body = Buffer.from(`{"ResultCount":${responses.length},"Data":[${rows}]}`, "utf8");
  }
  return reply
    .code(200)
    .header("content-type", "application/octet-stream")
    .header("content-disposition", contentDisposition(`${survey.name}.${csv ? "csv" : "json"}`))
    .send(body);
}

/**
 * `deleteResult`: the response `instanceId` of the survey with post ID `postId` (the whole run it
 * belongs to, ADR 0038; any save's ID of the run names it). An unknown `instanceId` changes nothing
 * and answers as a delete, as the old API; the refusal names the post ID.
 */
export async function deleteResult(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const client = studio(request);
  const postId = await boundGuid(request, "postId");
  const instanceId = await boundGuid(request, "instanceId");
  const found = await client.GET("/surveys", { params: { query: { postId } } });
  if (found.data === undefined) return unexpectedStatus(found.response);
  const survey = found.data.items[0];
  if (survey === undefined) return notAuthorized(reply, MODIFY, postId);
  const { response } = await client.DELETE("/surveys/{surveyId}/results/{responseId}", {
    params: { path: { surveyId: survey.id, responseId: instanceId } },
  });
  // `404`: no save has that ID (the survey was just found).
  if (response.status === 204 || response.status === 404) return sendEmpty(reply, 200);
  if (response.status === 403) return notAuthorized(reply, MODIFY, postId);
  return unexpectedStatus(response);
}

/** `deleteAllResults`: every response of the survey `id`. */
export async function deleteAllResults(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const id = await boundGuid(request, "id");
  const { response } = await studio(request).DELETE("/surveys/{surveyId}/results", {
    params: { path: { surveyId: id } },
  });
  if (response.status === 204) return sendEmpty(reply, 200);
  if (isRefusal(response.status)) return notAuthorized(reply, MODIFY, id);
  return unexpectedStatus(response);
}
