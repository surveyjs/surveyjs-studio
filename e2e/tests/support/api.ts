import type { Page } from "@playwright/test";
import { sandboxMode } from "./sandbox.js";
import { expectErrorResponse } from "./test.js";

/** A file part of a multipart body, as Playwright's `multipart` option takes it. */
export interface FilePart {
  readonly name: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
}

/** The options of a request: the subset of Playwright's request options the specs use. */
export interface ApiRequestOptions {
  readonly headers?: Record<string, string>;
  /** A JSON value (sent as JSON), a string or bytes. */
  readonly data?: unknown;
  readonly multipart?: Record<string, string | FilePart>;
}

/** An answer: the subset of Playwright's `APIResponse` the specs use. */
export interface ApiResponse {
  status(): number;
  ok(): boolean;
  headers(): Record<string, string>;
  body(): Promise<Buffer>;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** Requests to the app's API, as the signed-in page would send them. */
export interface Api {
  get(url: string, options?: ApiRequestOptions): Promise<ApiResponse>;
  post(url: string, options?: ApiRequestOptions): Promise<ApiResponse>;
  put(url: string, options?: ApiRequestOptions): Promise<ApiResponse>;
  patch(url: string, options?: ApiRequestOptions): Promise<ApiResponse>;
  delete(url: string, options?: ApiRequestOptions): Promise<ApiResponse>;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * The one way the specs call the API for set-up and checks. On a server it is the page's
 * `APIRequestContext` (`page.request`), which shares the page's cookies. On the sandbox build a
 * request from Node never reaches the page's service worker, so each request is a `fetch` run in
 * the page instead: the page must be open on the app (any of its pages), as it is after sign-in.
 */
export function api(page: Page): Api {
  const send = (method: Method) => (url: string, options?: ApiRequestOptions) =>
    sandboxMode ? fetchInPage(page, method, url, options) : viaRequest(page, method, url, options);
  return {
    get: send("GET"),
    post: send("POST"),
    put: send("PUT"),
    patch: send("PATCH"),
    delete: send("DELETE"),
  };
}

async function viaRequest(
  page: Page,
  method: Method,
  url: string,
  options: ApiRequestOptions = {},
): Promise<ApiResponse> {
  // Playwright's own answer has every method of ApiResponse.
  const { data, ...rest } = options;
  return page.request.fetch(url, {
    method,
    ...rest,
    ...(data !== undefined && { data: data as string | Buffer | object }),
  });
}

/** What crosses into the page: bytes travel as base64. */
type WireBody =
  | { readonly kind: "none" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "bytes"; readonly base64: string }
  | {
      readonly kind: "multipart";
      readonly parts: readonly (
        | { readonly field: string; readonly value: string }
        | {
            readonly field: string;
            readonly name: string;
            readonly mimeType: string;
            readonly base64: string;
          }
      )[];
    };

interface WireAnswer {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly base64: string;
}

function wireBody(options: ApiRequestOptions, headers: Record<string, string>): WireBody {
  if (options.multipart !== undefined) {
    return {
      kind: "multipart",
      parts: Object.entries(options.multipart).map(([field, value]) =>
        typeof value === "string"
          ? { field, value }
          : {
              field,
              name: value.name,
              mimeType: value.mimeType,
              base64: value.buffer.toString("base64"),
            },
      ),
    };
  }
  const { data } = options;
  if (data === undefined) return { kind: "none" };
  if (Buffer.isBuffer(data)) return { kind: "bytes", base64: data.toString("base64") };
  if (typeof data === "string") return { kind: "text", text: data };
  // As Playwright does: a value that is not a string or bytes goes as JSON.
  if (!Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
    headers["Content-Type"] = "application/json";
  }
  return { kind: "text", text: JSON.stringify(data) };
}

async function fetchInPage(
  page: Page,
  method: Method,
  url: string,
  options: ApiRequestOptions = {},
): Promise<ApiResponse> {
  if (!/^https?:/.test(page.url())) {
    throw new Error(`api(page) on the sandbox needs a page open on the app, not ${page.url()}`);
  }
  // The app renders only once the worker controls the page (web/src/main.tsx), so a page that
  // shows anything in #root can send requests to the mock.
  await page.waitForFunction(
    () =>
      navigator.serviceWorker?.controller != null &&
      (document.getElementById("root")?.childElementCount ?? 0) > 0,
    undefined,
    // Polled by time: a tab in the background runs no animation frames.
    { polling: 100, timeout: 10_000 },
  );
  const headers = { ...options.headers };
  const body = wireBody(options, headers);
  const answer = await page.evaluate(
    async ({ method, url, headers, body }): Promise<WireAnswer> => {
      const bytes = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      let payload: BodyInit | undefined;
      if (body.kind === "text") payload = body.text;
      else if (body.kind === "bytes") payload = bytes(body.base64);
      else if (body.kind === "multipart") {
        const form = new FormData();
        for (const part of body.parts) {
          if ("value" in part) form.append(part.field, part.value);
          else {
            const blob = new Blob([bytes(part.base64)], { type: part.mimeType });
            form.append(part.field, blob, part.name);
          }
        }
        payload = form;
      }
      const response = await fetch(url, {
        method,
        headers,
        credentials: "same-origin",
        ...(payload !== undefined && { body: payload }),
      });
      const buffer = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let i = 0; i < buffer.length; i += 0x8000) {
        binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
      }
      const answerHeaders: Record<string, string> = {};
      response.headers.forEach((value, name) => (answerHeaders[name] = value));
      return { status: response.status, headers: answerHeaders, base64: btoa(binary) };
    },
    { method, url, headers, body },
  );
  // Chromium logs an error answer of a page's fetch as a console error, as it does the app's own:
  // the console guard expects this one.
  if (answer.status >= 400) {
    expectErrorResponse(page, { path: new URL(url, page.url()).pathname, status: answer.status });
  }
  const bytes = Buffer.from(answer.base64, "base64");
  return {
    status: () => answer.status,
    ok: () => answer.status >= 200 && answer.status < 300,
    headers: () => answer.headers,
    body: () => Promise.resolve(bytes),
    text: () => Promise.resolve(bytes.toString("utf8")),
    json: () => Promise.resolve(JSON.parse(bytes.toString("utf8")) as unknown),
  };
}
