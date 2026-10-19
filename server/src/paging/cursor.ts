import { AppError } from "../errors.js";
import type { HistoryPosition, ResponsePosition, SurveyPosition } from "../providers/types.js";

/**
 * Opaque paging cursors: base64url (no padding) of a UTF-8 JSON payload.
 *
 * - Surveys: `{"v":1,"k":"surveys","p":<scope>,"a":<archived>,"u":<updatedAt>,"i":<id>}`, where the
 *   scope is `personal` or the lower-case project id. A cursor belongs to one list (scope and archived).
 * - Projects: `{"v":1,"k":"projects","n":<lower-cased name>,"i":<id>}`.
 * - History: `{"v":1,"k":"history","u":<at>,"i":<entry id>}`.
 * - Results: `{"v":1,"k":"results","s":<survey id, lower-case>,"u":<submittedAt>,"i":<response id>}`.
 *   A cursor belongs to one survey.
 *
 * Only the canonical encoding is accepted: a value is valid when encoding what it decodes to gives
 * the value back (so no padding, no extra members or spaces, upper-case ids or loose timestamps).
 */

/** The survey list a cursor belongs to. */
export interface SurveyList {
  /** `personal`, or the lower-case project id. */
  readonly scope: string;
  readonly archived: boolean;
}

/** A place in the project list order (name ignoring case, then id). */
export interface ProjectPosition {
  /** The project name, lower-cased. */
  readonly name: string;
  readonly id: string;
}

const VERSION = 1;
const MAX_CURSOR_LENGTH = 1024;
const MAX_ID_LENGTH = 64;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function invalidCursor(): AppError {
  return new AppError({
    code: "bad-request",
    status: 400,
    title: "Bad request",
    detail: "Invalid cursor.",
  });
}

const encode = (payload: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

/** The payload object, or an invalid-cursor error. */
function decode(value: string): Record<string, unknown> {
  if (value.length > MAX_CURSOR_LENGTH || !BASE64URL.test(value)) throw invalidCursor();
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw invalidCursor();
  }
  return payload as Record<string, unknown>;
}

const isId = (value: unknown): value is string =>
  typeof value === "string" && value !== "" && value.length <= MAX_ID_LENGTH;

/** An ISO 8601 UTC timestamp exactly as `Date#toISOString` writes it. */
function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  if (Number.isNaN(time) || new Date(time).toISOString() !== value) return false;
  // Four-digit years only, within the range of SQL `datetime` (azure-legacy binds this value).
  return /^\d{4}-/.test(value) && Number(value.slice(0, 4)) >= 1753;
}

/** Rejects a value that is not the canonical encoding of what it decoded to. */
function canonical<T>(value: string, decoded: T, reencoded: string): T {
  if (reencoded !== value) throw invalidCursor();
  return decoded;
}

const surveyPayload = (position: SurveyPosition, list: SurveyList) => ({
  v: VERSION,
  k: "surveys",
  p: list.scope,
  a: list.archived,
  u: position.updatedAt,
  i: position.id,
});

export function encodeSurveyCursor(position: SurveyPosition, list: SurveyList): string {
  return encode(surveyPayload(position, list));
}

/**
 * The position of a survey cursor of `list`. Throws `400 bad-request` ("Invalid cursor.") for
 * anything else, including a cursor of another scope or archived state.
 */
export function decodeSurveyCursor(value: string, list: SurveyList): SurveyPosition {
  const { v, k, p, a, u, i } = decode(value);
  if (v !== VERSION || k !== "surveys" || p !== list.scope || a !== list.archived) {
    throw invalidCursor();
  }
  if (!isTimestamp(u) || !isId(i)) throw invalidCursor();
  // Stores compare ids case-sensitively and hold them lower-case: an upper-case id would skew a
  // walk, and fails the canonical check below.
  const position = { updatedAt: u, id: i.toLowerCase() };
  return canonical(value, position, encodeSurveyCursor(position, list));
}

const projectPayload = (position: ProjectPosition) => ({
  v: VERSION,
  k: "projects",
  n: position.name.toLowerCase(),
  i: position.id,
});

/** The name is lower-cased, as the project list order compares it. */
export function encodeProjectCursor(position: ProjectPosition): string {
  return encode(projectPayload(position));
}

/** The position of a project cursor; throws `400 bad-request` ("Invalid cursor.") otherwise. */
export function decodeProjectCursor(value: string): ProjectPosition {
  const { v, k, n, i } = decode(value);
  if (v !== VERSION || k !== "projects" || typeof n !== "string" || !isId(i)) {
    throw invalidCursor();
  }
  const position = { name: n.toLowerCase(), id: i.toLowerCase() };
  return canonical(value, position, encodeProjectCursor(position));
}

const historyPayload = (position: HistoryPosition) => ({
  v: VERSION,
  k: "history",
  u: position.at,
  i: position.id,
});

export function encodeHistoryCursor(position: HistoryPosition): string {
  return encode(historyPayload(position));
}

/** The position of a history cursor; throws `400 bad-request` ("Invalid cursor.") otherwise. */
export function decodeHistoryCursor(value: string): HistoryPosition {
  const { v, k, u, i } = decode(value);
  if (v !== VERSION || k !== "history" || !isTimestamp(u) || !isId(i)) throw invalidCursor();
  const position = { at: u, id: i.toLowerCase() };
  return canonical(value, position, encodeHistoryCursor(position));
}

const resultsPayload = (position: ResponsePosition, surveyId: string) => ({
  v: VERSION,
  k: "results",
  s: surveyId.toLowerCase(),
  u: position.submittedAt,
  i: position.id,
});

export function encodeResultsCursor(position: ResponsePosition, surveyId: string): string {
  return encode(resultsPayload(position, surveyId));
}

/**
 * The position of a results cursor of `surveyId`. Throws `400 bad-request` ("Invalid cursor.") for
 * anything else, including a cursor of another survey.
 */
export function decodeResultsCursor(value: string, surveyId: string): ResponsePosition {
  const { v, k, s, u, i } = decode(value);
  if (v !== VERSION || k !== "results" || s !== surveyId.toLowerCase()) throw invalidCursor();
  if (!isTimestamp(u) || !isId(i)) throw invalidCursor();
  const position = { submittedAt: u, id: i.toLowerCase() };
  return canonical(value, position, encodeResultsCursor(position, surveyId));
}
