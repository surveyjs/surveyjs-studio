// Opaque paging cursors, as server/src/paging/cursor.ts: base64url (no padding) of a UTF-8 JSON
// payload `{"v":1,"k":<kind>,...}`. Only the canonical encoding is accepted: a value is valid when
// encoding what it decodes to gives the value back. Browser code: no `Buffer`.
import { badRequest } from "./problems";

const VERSION = 1;
const MAX_CURSOR_LENGTH = 1024;
const MAX_ID_LENGTH = 64;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const invalidCursor = () => badRequest("Invalid cursor.");

function encode(payload: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decode(value: string): Record<string, unknown> {
  if (value.length > MAX_CURSOR_LENGTH || !BASE64URL.test(value)) throw invalidCursor();
  let payload: unknown;
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
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
const isGuid = (value: unknown): value is string => typeof value === "string" && GUID.test(value);

/** An ISO 8601 UTC timestamp exactly as `Date#toISOString` writes it (years 1753 and later). */
function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  if (Number.isNaN(time) || new Date(time).toISOString() !== value) return false;
  return /^\d{4}-/.test(value) && Number(value.slice(0, 4)) >= 1753;
}

function canonical<T>(value: string, decoded: T, reencoded: string): T {
  if (reencoded !== value) throw invalidCursor();
  return decoded;
}

/** The survey list a cursor belongs to: `personal` or the lower-case project id, and archived. */
export interface SurveyList {
  readonly scope: string;
  readonly archived: boolean;
}
export interface SurveyPosition {
  readonly updatedAt: string;
  readonly id: string;
}

export function encodeSurveyCursor(position: SurveyPosition, list: SurveyList): string {
  return encode({
    v: VERSION,
    k: "surveys",
    p: list.scope,
    a: list.archived,
    u: position.updatedAt,
    i: position.id,
  });
}

/** `400 bad-request` ("Invalid cursor.") for anything but a canonical cursor of this list. */
export function decodeSurveyCursor(value: string, list: SurveyList): SurveyPosition {
  const { v, k, p, a, u, i } = decode(value);
  if (v !== VERSION || k !== "surveys" || p !== list.scope || a !== list.archived) {
    throw invalidCursor();
  }
  if (!isTimestamp(u) || !isGuid(i)) throw invalidCursor();
  const position = { updatedAt: u, id: i.toLowerCase() };
  return canonical(value, position, encodeSurveyCursor(position, list));
}

export interface HistoryPosition {
  readonly at: string;
  readonly id: string;
}

export function encodeHistoryCursor(position: HistoryPosition): string {
  return encode({ v: VERSION, k: "history", u: position.at, i: position.id });
}

export function decodeHistoryCursor(value: string): HistoryPosition {
  const { v, k, u, i } = decode(value);
  if (v !== VERSION || k !== "history" || !isTimestamp(u) || !isGuid(i)) throw invalidCursor();
  const position = { at: u, id: i.toLowerCase() };
  return canonical(value, position, encodeHistoryCursor(position));
}

/** A place in the project list order (name lower-cased, then id). */
export interface NamePosition {
  readonly name: string;
  readonly id: string;
}

export function encodeProjectCursor(position: NamePosition): string {
  return encode({ v: VERSION, k: "projects", n: position.name.toLowerCase(), i: position.id });
}

export function decodeProjectCursor(value: string): NamePosition {
  const { v, k, n, i } = decode(value);
  if (v !== VERSION || k !== "projects" || typeof n !== "string" || !isId(i)) {
    throw invalidCursor();
  }
  const position = { name: n.toLowerCase(), id: i.toLowerCase() };
  return canonical(value, position, encodeProjectCursor(position));
}

export function encodeMembersCursor(position: NamePosition, projectId: string): string {
  return encode({
    v: VERSION,
    k: "members",
    p: projectId.toLowerCase(),
    n: position.name.toLowerCase(),
    i: position.id,
  });
}

/** `400 bad-request` for anything but a canonical cursor of this project's members. */
export function decodeMembersCursor(value: string, projectId: string): NamePosition {
  const { v, k, p, n, i } = decode(value);
  if (v !== VERSION || k !== "members" || p !== projectId.toLowerCase()) throw invalidCursor();
  if (typeof n !== "string" || !isId(i)) throw invalidCursor();
  const position = { name: n.toLowerCase(), id: i.toLowerCase() };
  return canonical(value, position, encodeMembersCursor(position, projectId));
}

export interface ResponsePosition {
  readonly submittedAt: string;
  readonly id: string;
}

export function encodeResultsCursor(position: ResponsePosition, surveyId: string): string {
  return encode({
    v: VERSION,
    k: "results",
    s: surveyId.toLowerCase(),
    u: position.submittedAt,
    i: position.id,
  });
}

/** `400 bad-request` for anything but a canonical cursor of this survey's results. */
export function decodeResultsCursor(value: string, surveyId: string): ResponsePosition {
  const { v, k, s, u, i } = decode(value);
  if (v !== VERSION || k !== "results" || s !== surveyId.toLowerCase()) throw invalidCursor();
  if (!isTimestamp(u) || !isGuid(i)) throw invalidCursor();
  const position = { submittedAt: u, id: i.toLowerCase() };
  return canonical(value, position, encodeResultsCursor(position, surveyId));
}
