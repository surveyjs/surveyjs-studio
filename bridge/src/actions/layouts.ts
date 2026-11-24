// The old API's results layout actions (reference behaviour: ADR 0040 point 4): the survey's
// shared Table and Summary states and its older column layout, read and saved through Studio's
// shared layouts (`getSurveyLayout`, `saveSurveyLayout`, `deleteSurveyLayout`) with the caller's
// key; the permissions list, which is the survey's private questions (`privateResultQuestions`);
// the computed result columns; and the unauthenticated public reads, through `getPublicLayout` and
// `getPublicResults`. The state reads answer the layout as a JSON string holding JSON, combined
// with the private questions as the old code combined its permissions list: with none, the stored
// text as it is; with some, each element's `isPublic` set (false for a private question's, true
// for any other) and the layout written again compactly. A survey Studio does not show the caller
// (`404`) or does not let them change (`403`) gets the old "You are not authorized …" answer.
import type { FastifyReply, FastifyRequest, RouteHandlerMethod } from "fastify";
import { sendEmpty, sendJsonNull, sendJsonString, sendJsonText } from "../answers.js";
import { boundGuid, EMPTY_GUID, formOf } from "../binding.js";
import { ColumnsRefused, localeOf, resultColumns, type ColumnsResponse } from "../columns.js";
import { contextOf } from "../context.js";
import { JsonNumber, oldJson, parseStudioJson } from "../dotnet-format.js";
import { bindJsonBody, parseLenientJson } from "../json-body.js";
import { studioFor } from "../key.js";
import { StudioFailure, unexpectedStatus, type StudioClient } from "../studio.js";
import { isJson } from "./content.js";
import { allPages, PAGE_LIMIT, pageReader } from "./responses.js";
import { publicPageReader, publicPagesFrom } from "./results.js";

const MODIFY = "You are not authorized to modify the survey";
const GET_RESULTS = "You are not authorized to get results of the survey";
/** The old public state reads' refusal, the Table's too (its text came from the Summary's). */
const GET_SUMMARY_STATE = "You are not authorized to get summary state of the survey";

type LayoutKind = "table" | "summary" | "columns";

function studio(request: FastifyRequest): StudioClient {
  return studioFor(request, contextOf(request).settings);
}

/** Studio does not show the survey to the caller, or does not let them change it. */
const isRefusal = (status: number) => status === 403 || status === 404;

function notAuthorized(reply: FastifyReply, message: string, id: string): FastifyReply {
  return sendJsonString(reply, 400, `${message} ${id}`);
}

// ---------------------------------------------------------------- The old texts

/** What the old code failed on while reading or combining a layout: an empty `400`. */
export class LayoutRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutRefused";
  }
}

/** The characters the old serializer escaped beyond JSON's own: NEL and the line separators. */
function withOldEscapes(json: string): string {
  return json.replace(
    /[\u0085\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** A JSON answer as the old serializer wrote it. */
function sendOldJson(reply: FastifyReply, json: string): FastifyReply {
  return sendJsonText(reply, 200, withOldEscapes(json));
}

/** A layout read's answer: its text as a JSON string; JSON null without one. */
function sendLayout(reply: FastifyReply, text: string | null): FastifyReply {
  return text === null ? sendJsonNull(reply) : sendOldJson(reply, JSON.stringify(text));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof JsonNumber);

/** The old `visibility` numbers and their replacements in a state, exactly as text. */
const OLD_VISIBILITY: readonly (readonly [string, string])[] = [
  ['"visibility":0', '"isVisible":true,"isPublic":true'],
  ['"visibility":1', '"isVisible":false,"isPublic":true'],
  ['"visibility":2', '"isVisible":true,"isPublic":false'],
  ['"visibility":"0"', '"isVisible":true,"isPublic":true'],
  ['"visibility":"1"', '"isVisible":false,"isPublic":true'],
  ['"visibility":"2"', '"isVisible":true,"isPublic":false'],
];

/** A stored state with the old `visibility` numbers rewritten as the old reads did, as text. */
export function withoutOldVisibility(text: string): string {
  return OLD_VISIBILITY.reduce((result, [old, now]) => result.replaceAll(old, now), text);
}

/** A layout text read as the old reader did (lenient JSON); refused when it is none. */
function parseLayout(text: string): unknown {
  try {
    return parseStudioJson(text);
  } catch {
    const lenient = parseLenientJson(text);
    if (lenient === undefined) throw new LayoutRefused("a layout that is no JSON");
    return lenient.value;
  }
}

/**
 * A layout written again as the old serializer wrote it: compact, numbers as it wrote them (`1.0`
 * stays), texts as they are (dates are not rewritten: a layout is the caller's own document).
 */
function layoutJson(value: unknown): string {
  return withOldEscapes(oldJson(value, false, { strings: "as-stored" }));
}

/** The `elements` of a state, which must be a JSON object holding a list of objects. */
function elementsOf(state: unknown): Record<string, unknown>[] {
  if (!isRecord(state)) throw new LayoutRefused("a layout that is no JSON object");
  const { elements } = state;
  if (!Array.isArray(elements)) throw new LayoutRefused("a layout without elements");
  if (!elements.every(isRecord)) throw new LayoutRefused("an element that is no object");
  return elements;
}

/** A name's text as the old code compared it: a text as it is, `null` as empty. */
function nameText(value: unknown): string {
  if (typeof value === "string") return value;
  return value === null ? "" : layoutJson(value);
}

/**
 * The state combined with the private questions, as the old code combined it with its permissions
 * list: none, the text as it is; some, every element's `isPublic` set (false for a private
 * question's, true for any other) and the state written again. An element without a `name` fails.
 */
export function combinedState(text: string, privateQuestions: readonly string[]): string {
  if (privateQuestions.length === 0) return text;
  const state = parseLayout(text);
  const hidden = new Set(privateQuestions);
  for (const element of elementsOf(state)) {
    if (!Object.hasOwn(element, "name")) throw new LayoutRefused("an element without a name");
    element.isPublic = !hidden.has(nameText(element.name));
  }
  return layoutJson(state);
}

/**
 * The Table state the old read made of the columns layout when there was no Table state:
 * `{"elements":<its columns>}` (`null` without any); a layout that is no object, or columns that
 * are no list, fail.
 */
export function tableFromColumns(columnsText: string): string {
  const layout = parseLayout(withoutOldVisibility(columnsText));
  if (!isRecord(layout)) throw new LayoutRefused("a columns layout that is no JSON object");
  if (!Object.hasOwn(layout, "columns")) return '{"elements":null}';
  if (!Array.isArray(layout.columns)) throw new LayoutRefused("columns that are no list");
  // Rewritten again after writing, so a spaced `"visibility": 2` reads as the compact one.
  return withoutOldVisibility(layoutJson({ elements: layout.columns }));
}

/**
 * A state read's text: the stored state (for the Table, else the columns layout made into one),
 * its old `visibility` numbers rewritten, combined with the private questions; `null` without one.
 */
export function stateText(
  kind: "table" | "summary",
  stored: string | null,
  columns: string | null,
  privateQuestions: readonly string[],
): string | null {
  let text = stored === null || stored === "" ? null : withoutOldVisibility(stored);
  if (text === null && kind === "table" && columns !== null && columns !== "") {
    text = tableFromColumns(columns);
  }
  return text === null ? null : combinedState(text, privateQuestions);
}

/** An `isPublic` as the old code read it as a boolean; what it could not read fails. */
function oldBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value instanceof JsonNumber) return Number(value.text) !== 0;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true" || text === "false") return text === "true";
  }
  throw new LayoutRefused("an element whose isPublic is no boolean");
}

/** The public form of a state: only the elements whose `isPublic` is true. */
export function publicState(text: string): string {
  const state = parseLayout(text);
  const elements = elementsOf(state);
  (state as Record<string, unknown>).elements = elements.filter((element) =>
    oldBool(element.isPublic),
  );
  return layoutJson(state);
}

/**
 * The survey's private questions from an old permissions list (`[{"name":…,"isPublic":false}]`):
 * the names of the entries whose `isPublic` is exactly false, each once, as Studio reads the old
 * list. `undefined` for what the old code could not read: no list, an entry that is no object or
 * has no `name`.
 */
export function privateQuestionsOf(json: string): string[] | undefined {
  let value: unknown;
  try {
    value = parseLayout(json);
  } catch (error) {
    if (error instanceof LayoutRefused) return undefined;
    throw error;
  }
  if (!Array.isArray(value)) return undefined;
  const names: string[] = [];
  for (const permission of value) {
    if (!isRecord(permission) || !Object.hasOwn(permission, "name")) return undefined;
    const { name, isPublic } = permission;
    if (isPublic === false && typeof name === "string" && name !== "" && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

// ---------------------------------------------------------------- Studio

/**
 * The survey's shared layout of `kind`: its text, `null` without one, `refused` for a survey Studio
 * does not show the caller.
 */
async function readLayout(
  client: StudioClient,
  surveyId: string,
  kind: LayoutKind,
): Promise<string | null | "refused"> {
  const { data, error, response } = await client.GET("/surveys/{surveyId}/layouts/{kind}", {
    params: { path: { surveyId, kind } },
  });
  if (data !== undefined) return data.text;
  if (response.status === 404 && error?.code === "layout-not-found") return null;
  if (isRefusal(response.status)) return "refused";
  return unexpectedStatus(response);
}

/**
 * `getPublicLayout`: the layout text (`null` without one) and the private questions; `refused` for
 * an unknown survey or one whose results are not public.
 */
async function readPublicLayout(
  request: FastifyRequest,
  surveyId: string,
  kind: LayoutKind,
): Promise<{ text: string | null; privateQuestions: string[] } | "refused"> {
  const { data, response } = await request.studio.GET("/public/surveys/{surveyId}/layouts/{kind}", {
    params: { path: { surveyId, kind } },
  });
  if (data !== undefined) return data;
  if (response.status === 404) return "refused";
  return unexpectedStatus(response);
}

/** Whether the caller may change the survey (false when Studio does not show it to them). */
async function mayChange(client: StudioClient, surveyId: string): Promise<boolean> {
  const { data, response } = await client.GET("/surveys/{surveyId}", {
    params: { path: { surveyId } },
  });
  if (data !== undefined) return data.permissions.canModify;
  if (isRefusal(response.status)) return false;
  return unexpectedStatus(response);
}

/**
 * A write's answer: an empty `200`; the old refusal for a survey the caller cannot change; an empty
 * `400` for a value Studio refuses.
 */
function writeAnswer(reply: FastifyReply, response: Response, surveyId: string): FastifyReply {
  if (response.status === 200 || response.status === 204) return sendEmpty(reply, 200);
  if (isRefusal(response.status)) return notAuthorized(reply, MODIFY, surveyId);
  // Not stored: the old API's failed write.
  if (response.status === 400 || response.status === 413 || response.status === 422) {
    return sendEmpty(reply, 400);
  }
  return unexpectedStatus(response);
}

// ---------------------------------------------------------------- The bodies

const STATE_SHAPE = { Id: "guid", Json: "string" } as const;

interface StateBody {
  id: string;
  /** `null` when missing. */
  json: string | null;
}

/** A `{ Id, Json }` body read as JSON; `undefined` for anything the old binding failed on. */
function stateFromJson(text: string): StateBody | undefined {
  const { model, errors } = bindJsonBody(text, STATE_SHAPE);
  if (model === null || Object.keys(errors).length > 0) return undefined;
  return { id: model.Id ?? EMPTY_GUID, json: model.Json ?? null };
}

function bodyText(request: FastifyRequest): string {
  const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
  return new TextDecoder().decode(bytes);
}

function isForm(request: FastifyRequest): boolean {
  const type = (request.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  return type === "application/x-www-form-urlencoded" || type === "multipart/form-data";
}

/**
 * The `{ Id, Json }` body of the old form-or-JSON binding: a form's fields (names in any letter
 * case; a field given twice fails), or any other content type read as one JSON object with nothing
 * after it. `undefined` for an empty body or anything that failed.
 */
async function stateFromBodyOrForm(request: FastifyRequest): Promise<StateBody | undefined> {
  if (isForm(request)) {
    const form = await formOf(request);
    if (form === null) return undefined;
    // The form's text fields by name in any letter case, under the name's first spelling.
    const fields = new Map<string, { name: string; values: string[] }>();
    for (const [name, value] of form) {
      if (typeof value !== "string") continue;
      const field = fields.get(name.toLowerCase()) ?? { name, values: [] };
      field.values.push(value);
      fields.set(name.toLowerCase(), field);
    }
    const object = Object.fromEntries(
      [...fields.values()].map(({ name, values }) => [
        name,
        values.length > 1 ? values : values[0],
      ]),
    );
    return stateFromJson(JSON.stringify(object));
  }
  const text = bodyText(request);
  if (text.trim() === "" || parseLenientJson(text) === undefined) return undefined;
  return stateFromJson(text);
}

// ---------------------------------------------------------------- The reads

/** `getResultTableState`, `getResultSummaryState`: the shared state with the private questions. */
function stateRead(kind: "table" | "summary"): RouteHandlerMethod {
  return async function readState(request, reply) {
    const client = studio(request);
    const surveyId = await boundGuid(request, "id");
    const [survey, stored] = await Promise.all([
      client.GET("/surveys/{surveyId}", { params: { path: { surveyId } } }),
      readLayout(client, surveyId, kind),
    ]);
    if (isRefusal(survey.response.status) || stored === "refused") {
      return notAuthorized(reply, MODIFY, surveyId);
    }
    if (survey.data === undefined) return unexpectedStatus(survey.response);
    let columns: string | null = null;
    if (stored === null && kind === "table") {
      const read = await readLayout(client, surveyId, "columns");
      if (read === "refused") return notAuthorized(reply, MODIFY, surveyId);
      columns = read;
    }
    if (stored === null && columns === null) return sendJsonNull(reply);
    const privateQuestions = survey.data.settings.privateResultQuestions;
    // Without the private questions the bridge cannot tell which elements are public.
    if (privateQuestions === undefined) {
      throw new StudioFailure(500, "Studio could not read the private questions");
    }
    try {
      return sendLayout(reply, stateText(kind, stored, columns, privateQuestions));
    } catch (error) {
      if (error instanceof LayoutRefused) return sendEmpty(reply, 400);
      throw error;
    }
  } as RouteHandlerMethod;
}

export const getResultTableState = stateRead("table");
export const getResultSummaryState = stateRead("summary");

/** `getPublicResultTableState`, `getPublicResultSummaryState`: the public elements, no key. */
function publicStateRead(kind: "table" | "summary"): RouteHandlerMethod {
  return async function readPublicState(request, reply) {
    const surveyId = await boundGuid(request, "id");
    if (surveyId === EMPTY_GUID) return notAuthorized(reply, GET_SUMMARY_STATE, surveyId);
    const layout = await readPublicLayout(request, surveyId, kind);
    if (layout === "refused") return notAuthorized(reply, GET_SUMMARY_STATE, surveyId);
    let columns: string | null = null;
    if (layout.text === null && kind === "table") {
      const read = await readPublicLayout(request, surveyId, "columns");
      if (read === "refused") return notAuthorized(reply, GET_SUMMARY_STATE, surveyId);
      columns = read.text;
    }
    try {
      const text = stateText(kind, layout.text, columns, layout.privateQuestions);
      return sendLayout(reply, text === null ? null : publicState(text));
    } catch (error) {
      if (error instanceof LayoutRefused) return sendEmpty(reply, 400);
      throw error;
    }
  } as RouteHandlerMethod;
}

export const getPublicResultTableState = publicStateRead("table");
export const getPublicResultSummaryState = publicStateRead("summary");

/** The items of every page, in order. */
async function* itemsOf<T>(pages: AsyncIterable<{ items: readonly T[] }>): AsyncGenerator<T> {
  for await (const page of pages) yield* page.items;
}

/** The old `{ Columns, Id }` answer, or an empty `400` where the old calculation failed. */
async function sendColumns(
  reply: FastifyReply,
  input: Parameters<typeof resultColumns>[0],
): Promise<FastifyReply> {
  try {
    return sendOldJson(reply, JSON.stringify(await resultColumns(input)));
  } catch (error) {
    if (error instanceof ColumnsRefused) return sendEmpty(reply, 400);
    throw error;
  }
}

/**
 * `getResultColumns`: the result columns computed from the definition, every response and the
 * columns layout, titled in the first `Accept-Language` entry's language (an entry the old code
 * could not read is an empty `400`, after the permission answer).
 */
export async function getResultColumns(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const client = studio(request);
  const surveyId = await boundGuid(request, "id");
  const survey = await client.GET("/surveys/{surveyId}", { params: { path: { surveyId } } });
  if (isRefusal(survey.response.status)) return notAuthorized(reply, MODIFY, surveyId);
  if (survey.data === undefined) return unexpectedStatus(survey.response);
  const locale = localeOf(request.headers["accept-language"]);
  if (locale === "bad") return sendEmpty(reply, 400);
  const { settings } = survey.data;

  const read = pageReader(client, surveyId);
  const [definition, columnsLayout, first] = await Promise.all([
    client.GET("/surveys/{surveyId}/definition", {
      params: { path: { surveyId } },
      parseAs: "text",
    }),
    readLayout(client, surveyId, "columns"),
    read(undefined, PAGE_LIMIT),
  ]);
  if (isRefusal(definition.response.status) || columnsLayout === "refused") {
    return notAuthorized(reply, MODIFY, surveyId);
  }
  if (definition.data === undefined) return unexpectedStatus(definition.response);
  // Only a cursor can be refused.
  if (first === "refused" || first === "bad-cursor") return notAuthorized(reply, MODIFY, surveyId);
  // The private questions mark only a layout's columns: without one they are not needed.
  const privateQuestions = columnsLayout === null ? [] : settings.privateResultQuestions;
  if (privateQuestions === undefined) {
    throw new StudioFailure(500, "Studio could not read the private questions");
  }
  return sendColumns(reply, {
    definition: parseStudioJson(definition.data),
    responses: itemsOf<ColumnsResponse>(allPages(request, read, first, surveyId)),
    columnsLayout,
    privateQuestions,
    locale,
    storeIp: settings.storeRespondentIp === true,
  });
}

/**
 * `getResultPublicColumns`: as `getResultColumns`, from the public results while they are public,
 * no key. Public results carry no client ID, no IP and no private question's answers, so their
 * columns are not among these.
 */
export async function getResultPublicColumns(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const surveyId = await boundGuid(request, "id");
  if (surveyId === EMPTY_GUID) return notAuthorized(reply, GET_RESULTS, surveyId);
  const layout = await readPublicLayout(request, surveyId, "columns");
  if (layout === "refused") return notAuthorized(reply, GET_RESULTS, surveyId);
  const locale = localeOf(request.headers["accept-language"]);
  if (locale === "bad") return sendEmpty(reply, 400);

  const read = publicPageReader(request, surveyId);
  const first = await read(undefined);
  if (first === "refused") return notAuthorized(reply, GET_RESULTS, surveyId);
  return sendColumns(reply, {
    definition: first.definition,
    responses: itemsOf(publicPagesFrom(request, read, first, surveyId)),
    columnsLayout: layout.text,
    privateQuestions: layout.privateQuestions,
    locale,
    storeIp: false,
  });
}

// ---------------------------------------------------------------- The writes

/**
 * `setResultTableState`, `setResultSummaryState`: `{ Id, Json }` as a form or JSON; `Json` saved
 * as the shared state verbatim, or, missing or empty, the state deleted.
 */
function stateWrite(kind: "table" | "summary"): RouteHandlerMethod {
  return async function writeState(request, reply) {
    const body = await stateFromBodyOrForm(request);
    if (body === undefined) return sendEmpty(reply, 400);
    const client = studio(request);
    const params = { params: { path: { surveyId: body.id, kind } } };
    const { response } =
      body.json === null || body.json === ""
        ? await client.DELETE("/surveys/{surveyId}/layouts/{kind}", params)
        : await client.PUT("/surveys/{surveyId}/layouts/{kind}", {
            ...params,
            body: { text: body.json },
          });
    return writeAnswer(reply, response, body.id);
  } as RouteHandlerMethod;
}

export const setResultTableState = stateWrite("table");
export const setResultSummaryState = stateWrite("summary");

/**
 * `setResultColumns`: `{ Id, Json }`, JSON only (anything else an empty `415`); `Json` saved as the
 * columns layout verbatim; missing or empty, nothing changes.
 */
export async function setResultColumns(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (!isJson(request)) return sendEmpty(reply, 415);
  const body = stateFromJson(bodyText(request));
  if (body === undefined) return sendEmpty(reply, 400);
  const client = studio(request);
  if (body.json === null || body.json === "") {
    return (await mayChange(client, body.id))
      ? sendEmpty(reply, 200)
      : notAuthorized(reply, MODIFY, body.id);
  }
  const { response } = await client.PUT("/surveys/{surveyId}/layouts/{kind}", {
    params: { path: { surveyId: body.id, kind: "columns" } },
    body: { text: body.json },
  });
  return writeAnswer(reply, response, body.id);
}

/**
 * `setResultPermissions`: `{ Id, Json }` as a form or JSON; the names `Json` marks not public
 * become the survey's private questions (the whole list). Missing or empty, nothing changes; a list
 * the old code could not read is an empty `400`, after the permission answer.
 */
export async function setResultPermissions(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const body = await stateFromBodyOrForm(request);
  if (body === undefined) return sendEmpty(reply, 400);
  const client = studio(request);
  const names = body.json === null || body.json === "" ? null : privateQuestionsOf(body.json);
  if (names === null || names === undefined) {
    if (!(await mayChange(client, body.id))) return notAuthorized(reply, MODIFY, body.id);
    return sendEmpty(reply, names === null ? 200 : 400);
  }
  const { response } = await client.PATCH("/surveys/{surveyId}", {
    params: { path: { surveyId: body.id } },
    body: { settings: { privateResultQuestions: names } },
  });
  return writeAnswer(reply, response, body.id);
}
