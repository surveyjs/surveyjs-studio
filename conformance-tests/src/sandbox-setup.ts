/**
 * `CONFORMANCE_PROVIDER=sandbox`: registers the sandbox's mock handlers (the web app's in-browser
 * back-end, web/src/sandbox) with msw/node, so the suite's `fetch` calls reach them instead of a
 * server. A `setupFiles` entry: each test file gets its own module graph, so its own in-memory store
 * over the sandbox seed. Type-checked by tsconfig.sandbox.json (the web modules use bundler
 * resolution and the DOM types).
 */
import { setupServer } from "msw/node";
import { afterAll } from "vitest";
import { createSandboxHandlers } from "../../web/src/sandbox/handlers/index";
import seedJson from "../../web/src/sandbox/seed.json";
import type { SandboxSeed } from "../../web/src/sandbox/seed-types";
import { DEFAULT_SETTINGS } from "../../web/src/sandbox/settings";
import { createSandboxStore, memoryStorage } from "../../web/src/sandbox/store";

const seed = seedJson as unknown as SandboxSeed;

/** The `baseUrl` global-setup.ts provides in this mode (no request leaves the process). */
const ORIGIN = "http://sandbox.test";

const server = setupServer(
  ...createSandboxHandlers({
    store: createSandboxStore({ storage: memoryStorage(), seed, settings: DEFAULT_SETTINGS }),
    settings: DEFAULT_SETTINGS,
    origin: ORIGIN,
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
  }),
);
server.listen({ onUnhandledRequest: "error" });

// Under msw/node (2.15.0 on Node 24) cancelling the body of a mocked response never settles, and
// the suite cancels bodies it does not need. So each response is read to its end here and handed
// on as a new Response over the same bytes, status and headers; the handlers' answers are unchanged.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);
const mockedFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const response = await mockedFetch(input, init);
  const body = NULL_BODY_STATUSES.has(response.status) ? null : await response.arrayBuffer();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

afterAll(() => {
  globalThis.fetch = mockedFetch;
  server.close();
});
