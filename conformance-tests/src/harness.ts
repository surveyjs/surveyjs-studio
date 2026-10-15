/**
 * Shared helpers of the conformance test files: calls to the server under test, each response
 * checked against the contract, and signed-in sessions.
 */
import { openapiPath } from "@my-surveys/contract";
import { expect, inject, type TestContext } from "vitest";
import { fixtureUsers, signIn, SignInUnsupportedError, type SignInResult } from "./sign-in.js";
import { createValidator, type Validator } from "./validator.js";

export const baseUrl = inject("baseUrl");

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
export function sessionHeaders({ jar }: SignInResult): Record<string, string> {
  return { cookie: jar.header(), "x-csrf-token": jar.get("msid_csrf") ?? "" };
}
