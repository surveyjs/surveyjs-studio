import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach } from "vitest";
import { server } from "./server";

// The first render of a test file loads the app's lazy route modules; with the suite's files running
// in parallel that can take longer than Testing Library's default 1 s wait for `findBy…`/`waitFor`.
configure({ asyncUtilTimeout: 5000 });

/**
 * A `multipart/form-data` body for `form`, as a browser sends it (file names kept). jsdom's FormData
 * and File are not Node's, and Vitest's own conversion cannot read jsdom 30's files.
 */
function multipartBody(form: FormData): { body: ReadableStream<Uint8Array>; contentType: string } {
  const boundary = `----test-boundary-${Math.random().toString(16).slice(2)}`;
  const encoder = new TextEncoder();
  const entries = [...form.entries()];
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const [name, value] of entries) {
        const head =
          typeof value === "string"
            ? `Content-Disposition: form-data; name="${name}"`
            : `Content-Disposition: form-data; name="${name}"; filename="${value.name}"\r\n` +
              `Content-Type: ${value.type || "application/octet-stream"}`;
        controller.enqueue(encoder.encode(`--${boundary}\r\n${head}\r\n\r\n`));
        controller.enqueue(
          typeof value === "string"
            ? encoder.encode(value)
            : new Uint8Array(await value.arrayBuffer()),
        );
        controller.enqueue(encoder.encode("\r\n"));
      }
      controller.enqueue(encoder.encode(`--${boundary}--\r\n`));
      controller.close();
    },
  });
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

// Node's Request needs absolute URLs; the app uses a relative base URL ("/api/v1") like in a browser.
const NodeRequest = globalThis.Request;
globalThis.Request = class extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    let nodeInit = init;
    if (init?.body instanceof FormData) {
      const { body, contentType } = multipartBody(init.body);
      const headers = new Headers(init.headers);
      // As a browser: a Content-Type the caller set stays.
      if (!headers.has("Content-Type")) headers.set("Content-Type", contentType);
      nodeInit = { ...init, body, headers, duplex: "half" } as RequestInit;
    }
    super(
      typeof input === "string" && input.startsWith("/")
        ? new URL(input, window.location.href)
        : input,
      nodeInit,
    );
  }
};

// Listen at import time: openapi-fetch captures globalThis.fetch when the client module is created.
server.listen({ onUnhandledRequest: "error" });
afterEach(() => {
  cleanup();
  server.resetHandlers();
  // My Surveys remembers the list it shows there; a test must not open the previous test's list.
  window.localStorage.clear();
});
afterAll(() => server.close());

// jsdom does not implement scrolling, which the router calls on navigation.
window.scrollTo = () => {};
