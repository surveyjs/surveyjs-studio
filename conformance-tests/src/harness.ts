/**
 * Shared helpers of the conformance test files: calls to the server under test, each response
 * checked against the contract, and signed-in sessions.
 */
import { openapiPath } from "@surveyjs-studio/contract";
import { expect, inject, onTestFinished, type TestContext } from "vitest";
import {
  fixtureUsers,
  sandboxSession,
  signIn,
  SignInUnsupportedError,
  type CookieJar,
  type SignInResult,
} from "./sign-in.js";
import { createValidator, type Validator } from "./validator.js";

export const baseUrl = inject("baseUrl");
/** False with `CONFORMANCE_BASE_URL`: a deployment (behind a proxy) decides hop-by-hop headers. */
export const ownsServer = inject("ownsServer");
/** True with `CONFORMANCE_PROVIDER=sandbox`: the sandbox's mock handlers answer, under msw/node. */
export const sandbox = inject("sandbox");

let validatorPromise: Promise<Validator> | undefined;

/** The contract validator, created once per test file. */
export function validator(): Promise<Validator> {
  validatorPromise ??= createValidator(openapiPath);
  return validatorPromise;
}

export async function expectConforms(
  method: string,
  pathTemplate: string,
  response: Response,
): Promise<void> {
  expect(await (await validator()).check(method, pathTemplate, response)).toEqual([]);
}

export interface CallOptions {
  /** The concrete path, when it differs from the contract's path template. */
  readonly path?: string;
  readonly headers?: Record<string, string>;
  /** Sent as JSON. */
  readonly body?: unknown;
  /** Sent as is, with the JSON media type (e.g. malformed JSON). */
  readonly rawBody?: string;
}

/** Calls `/api/v1{path}` (redirects not followed) and fails unless the response conforms. */
export async function call(
  method: string,
  pathTemplate: string,
  options: CallOptions = {},
): Promise<Response> {
  const text =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  const response = await fetch(`${baseUrl}/api/v1${options.path ?? pathTemplate}`, {
    method,
    redirect: "manual",
    headers: {
      ...(text !== undefined && { "content-type": "application/json" }),
      ...options.headers,
    },
    ...(text !== undefined && { body: text }),
  });
  await expectConforms(method, pathTemplate, response);
  return response;
}

export interface UploadOptions {
  /** The concrete path, when it differs from the contract's path template. */
  readonly path?: string;
  readonly headers?: Record<string, string>;
  /** Sent as multipart/form-data (fetch sets the media type and its boundary). */
  readonly form: FormData;
}

/** POSTs a multipart form to `/api/v1{path}` and fails unless the response conforms. */
export async function upload(pathTemplate: string, options: UploadOptions): Promise<Response> {
  const response = await fetch(`${baseUrl}/api/v1${options.path ?? pathTemplate}`, {
    method: "POST",
    redirect: "manual",
    ...(options.headers && { headers: options.headers }),
    body: options.form,
  });
  await expectConforms("POST", pathTemplate, response);
  return response;
}

/** The Problem `code` of a response. */
export async function codeOf(response: Response): Promise<unknown> {
  return ((await response.clone().json()) as { code?: unknown }).code;
}

/**
 * Signs in through the login redirects and checks both API responses. Skips the test when the
 * sign-in driver cannot complete the server's identity provider.
 */
export async function signedIn(
  ctx: TestContext,
  userId: string = fixtureUsers.owner.id,
  returnTo = "/",
  complete: () => Promise<SignInResult> = () => signIn(baseUrl, userId, returnTo),
): Promise<SignInResult> {
  if (sandbox) ctx.skip("the sandbox has no sign-in over HTTP (D3)");
  let result: SignInResult;
  try {
    result = await complete();
  } catch (error) {
    if (error instanceof SignInUnsupportedError) ctx.skip(error.message);
    throw error;
  }
  await expectConforms("GET", "/auth/login", result.login);
  await expectConforms("GET", "/auth/callback", result.callback);
  return result;
}

/** Request headers of a signed-in browser that sends its CSRF token. */
export function sessionHeaders({ jar }: { jar: CookieJar }): Record<string, string> {
  return { cookie: jar.header(), "x-csrf-token": jar.get("msid_csrf") ?? "" };
}

const sessions = new Map<string, SignInResult>();

/** Request headers of the user's browser; signs in once per user and test file. */
export async function as(ctx: TestContext, user: { id: string }): Promise<Record<string, string>> {
  if (sandbox) {
    try {
      return sessionHeaders({ jar: sandboxSession(user.id) });
    } catch (error) {
      if (error instanceof SignInUnsupportedError) ctx.skip(error.message);
      throw error;
    }
  }
  let session = sessions.get(user.id);
  if (!session) {
    session = await signedIn(ctx, user.id);
    expect(session.callback.status).toBe(302);
    sessions.set(user.id, session);
  }
  return sessionHeaders(session);
}

const MERGE_PATCH = "application/merge-patch+json";

/**
 * Archives and deletes a survey the test created; a survey that is already gone is fine. Any
 * other answer fails the test, so a leftover survey is never silent.
 */
export async function cleanUp(headers: Record<string, string>, id: string): Promise<void> {
  const archived = await call("PATCH", "/surveys/{surveyId}", {
    path: `/surveys/${id}`,
    headers: { "content-type": MERGE_PATCH, ...headers },
    body: { archived: true },
  });
  if (archived.status === 404) return;
  expect(archived.status).toBe(200);
  const deleted = await call("DELETE", "/surveys/{surveyId}", { path: `/surveys/${id}`, headers });
  expect([204, 404]).toContain(deleted.status);
}

/** A definition with one text question `q1`. */
export const ONE_QUESTION = {
  pages: [{ name: "page1", elements: [{ type: "text", name: "q1" }] }],
};

export interface OwnSurveyOptions {
  readonly name?: string;
  readonly projectId?: string;
  /** Default `{}`. */
  readonly definition?: unknown;
  /**
   * `true` (the default) publishes the survey through `PATCH`; `false` unpublishes it. A new survey
   * is already published (its legacy flag is empty), so `false` is needed for an unpublished one.
   */
  readonly published?: boolean;
}

/**
 * Creates a survey as the user and registers its cleanup for the end of the test; returns its id.
 * Its legacy published flag stays empty, which means published.
 */
export async function newSurvey(
  headers: Record<string, string>,
  options: Omit<OwnSurveyOptions, "published"> = {},
): Promise<string> {
  const response = await call("POST", "/surveys", {
    headers,
    body: {
      definition: options.definition ?? {},
      ...(options.name !== undefined && { name: options.name }),
      ...(options.projectId !== undefined && { projectId: options.projectId }),
    },
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  onTestFinished(() => cleanUp(headers, id));
  return id;
}

/** Publishes or unpublishes a survey through `PATCH`; expects `200`. */
export async function setPublished(
  headers: Record<string, string>,
  id: string,
  published: boolean,
): Promise<void> {
  const patched = await call("PATCH", "/surveys/{surveyId}", {
    path: `/surveys/${id}`,
    headers: { "content-type": MERGE_PATCH, ...headers },
    body: { published },
  });
  expect(patched.status).toBe(200);
}

/**
 * Creates a survey as the user, publishes it (or unpublishes it with `published: false`), and
 * registers its cleanup for the end of the test; returns its id.
 */
export async function ownSurvey(
  headers: Record<string, string>,
  options: OwnSurveyOptions = {},
): Promise<string> {
  const id = await newSurvey(headers, options);
  await setPublished(headers, id, options.published ?? true);
  return id;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 15));

/**
 * Submits through the public API and waits, so the next submission has a later time. Returns the
 * response id.
 */
export async function submitted(
  surveyId: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<string> {
  const response = await call("POST", "/public/surveys/{surveyId}/responses", {
    path: `/public/surveys/${surveyId}/responses`,
    headers,
    body,
  });
  expect(response.status).toBe(201);
  await pause();
  return ((await response.json()) as { id: string }).id;
}

/** A page of a cursor list. */
export interface CursorPage<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

/** GETs a list page (path with its query) and fails unless it answers 200. */
export async function listPage<T = unknown>(
  pathTemplate: string,
  path: string,
  headers?: Record<string, string>,
): Promise<CursorPage<T>> {
  const response = await call("GET", pathTemplate, { path, ...(headers && { headers }) });
  expect(response.status).toBe(200);
  return (await response.json()) as CursorPage<T>;
}

/**
 * Follows `nextCursor` to the end; returns every page. `each` sees each page as it arrives. The
 * path may hold a query already.
 */
export async function walkPages<T = unknown>(
  pathTemplate: string,
  path: string,
  headers?: Record<string, string>,
  each?: (page: CursorPage<T>) => void,
): Promise<CursorPage<T>[]> {
  const pages: CursorPage<T>[] = [];
  let cursor: string | null = null;
  for (;;) {
    if (pages.length >= 1000) throw new Error("the list does not end");
    const join = path.includes("?") ? "&" : "?";
    const next: CursorPage<T> = await listPage<T>(
      pathTemplate,
      cursor === null ? path : `${path}${join}cursor=${encodeURIComponent(cursor)}`,
      headers,
    );
    each?.(next);
    pages.push(next);
    if (next.nextCursor === null) return pages;
    cursor = next.nextCursor;
  }
}

/** Every item of a cursor list, in order. */
export async function walkItems<T = unknown>(
  pathTemplate: string,
  path: string,
  headers?: Record<string, string>,
  each?: (page: CursorPage<T>) => void,
): Promise<T[]> {
  return (await walkPages<T>(pathTemplate, path, headers, each)).flatMap((p) => p.items);
}

/** A GUID as the API writes it (lower case). */
export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
