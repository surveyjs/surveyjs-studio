// Shared by the area handlers: the signed-in user, request parsing and validation (the checks the
// server's contract validation does before a handler runs: server/src/api.ts, server/src/errors.ts)
// and the read/write helpers that keep a write atomic over the stored document (D2).
import type { SandboxUser } from "../seed-types";
import type { SandboxData } from "../store";
import type { HandlerContext } from "./context";
import { currentUserId } from "./session";
import {
  badRequest,
  ProblemError,
  unauthenticated,
  validationFailed,
  type ProblemFieldError,
} from "./problems";

export const lower = (id: string): string => id.toLowerCase();
export const sameId = (a: string, b: string): boolean => lower(a) === lower(b);

/** Code-point order: the same on every machine (server/src/providers/ordering.ts `compare`). */
export const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The signed-in user in `data`, or `401 unauthenticated`. */
export function userOf(data: SandboxData, cookies: Record<string, string>): SandboxUser {
  const id = currentUserId(cookies, data);
  const user = data.users.find((candidate) => candidate.id === id);
  if (!user) throw unauthenticated();
  return user;
}

/** Authentication first, as the server's `onRequest` hook, before the body is read. */
export function requireSession(ctx: HandlerContext, cookies: Record<string, string>): void {
  userOf(ctx.store.read(), cookies);
}

/**
 * Applies `change` to the stored document and stores it in one write (nothing is stored when
 * `change` throws). `change` sees the document as it is at that moment, so a save made in another
 * tab between the request's reads and this write is not overwritten by a stale copy.
 */
export function mutate<T>(
  ctx: HandlerContext,
  cookies: Record<string, string>,
  change: (data: SandboxData, user: SandboxUser) => T,
): T {
  let result: T;
  ctx.store.write((data) => {
    result = change(data, userOf(data, cookies));
  });
  return result!;
}

/** Runs `read` on the stored document for the signed-in user. */
export function view<T>(
  ctx: HandlerContext,
  cookies: Record<string, string>,
  read: (data: SandboxData, user: SandboxUser) => T,
): T {
  const data = ctx.store.read();
  return read(data, userOf(data, cookies));
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The JSON body of a request. A missing body is `undefined` (the caller says whether it is
 * required); a body longer than `maxLength` is `413`; a body in a media type outside `mediaTypes` is
 * `415`; text that is no JSON is `400`.
 */
export async function readJson(
  request: Request,
  mediaTypes: readonly string[] = ["application/json"],
  maxLength?: number,
): Promise<unknown> {
  const text = await request.text();
  if (maxLength !== undefined && text.length > maxLength) {
    throw new ProblemError({
      code: "payload-too-large",
      status: 413,
      title: "Payload too large",
    });
  }
  if (text === "") return undefined;
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType === undefined || !mediaTypes.includes(mediaType)) {
    throw new ProblemError({
      code: "unsupported-media-type",
      status: 415,
      title: "Unsupported media type",
      detail: `Send the body as ${mediaTypes.join(" or ")}.`,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw badRequest();
  }
}

export const bodyRequired = () =>
  validationFailed([{ pointer: "", detail: "Request body is required" }]);

/** A JSON object body of an operation whose body is required. */
export function requiredObject(body: unknown): Record<string, unknown> {
  if (body === undefined) throw bodyRequired();
  if (!isRecord(body)) throw validationFailed([{ pointer: "", detail: "must be object" }]);
  return body;
}

/** Collects the field errors of a body and throws `422 validation-failed` when there are any. */
export function failOn(errors: ProblemFieldError[]): void {
  if (errors.length > 0) throw validationFailed(errors);
}

/** The code points of `text` (the contract's `maxLength` counts characters). */
const codePoints = (text: string): number => [...text].length;

/** Checks a survey `name` against the contract's schema (type, 1 to 200 characters). */
export function checkName(value: unknown, errors: ProblemFieldError[]): void {
  if (typeof value !== "string") {
    errors.push({ pointer: "/name", detail: "must be string" });
  } else if (value.length === 0) {
    errors.push({ pointer: "/name", detail: "must NOT have fewer than 1 characters" });
  } else if (codePoints(value) > 200) {
    errors.push({ pointer: "/name", detail: "must NOT have more than 200 characters" });
  }
}

/** Checks a nullable project id (a string of 1 to 64 characters, or null). */
export function checkProjectId(value: unknown, errors: ProblemFieldError[]): void {
  if (value === null) return;
  if (typeof value !== "string") {
    errors.push({ pointer: "/projectId", detail: "must be string,null" });
  } else if (value.length === 0 || value.length > 64) {
    errors.push({ pointer: "/projectId", detail: "must be between 1 and 64 characters" });
  }
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** The `limit` query parameter (integer 1 to 200, default 50); problems go to `errors`. */
export function parseLimit(params: URLSearchParams, errors: ProblemFieldError[]): number {
  const text = params.get("limit");
  if (text === null) return DEFAULT_LIMIT;
  if (!/^-?\d+$/.test(text)) errors.push({ pointer: "/limit", detail: "must be integer" });
  else if (Number(text) < 1) errors.push({ pointer: "/limit", detail: "must be >= 1" });
  else if (Number(text) > MAX_LIMIT) errors.push({ pointer: "/limit", detail: "must be <= 200" });
  return Number(text);
}

/** `limit` and `cursor` of a list; a bad `limit` is `400 bad-request` with its field error. */
export function parsePagingQuery(url: URL): { limit: number; cursor: string | undefined } {
  const errors: ProblemFieldError[] = [];
  const limit = parseLimit(url.searchParams, errors);
  if (errors.length > 0) throw badRequest(undefined, errors);
  return { limit, cursor: url.searchParams.get("cursor") ?? undefined };
}
