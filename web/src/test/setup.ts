import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach } from "vitest";
import { server } from "./server";

// The first render of a test file loads the app's lazy route modules; with the suite's files running
// in parallel that can take longer than Testing Library's default 1 s wait for `findBy…`/`waitFor`.
configure({ asyncUtilTimeout: 5000 });

// Node's Request needs absolute URLs; the app uses a relative base URL ("/api/v1") like in a browser.
const NodeRequest = globalThis.Request;
globalThis.Request = class extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(
      typeof input === "string" && input.startsWith("/")
        ? new URL(input, window.location.href)
        : input,
      init,
    );
  }
};

// Listen at import time: openapi-fetch captures globalThis.fetch when the client module is created.
server.listen({ onUnhandledRequest: "error" });
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

// jsdom does not implement scrolling, which the router calls on navigation.
window.scrollTo = () => {};
