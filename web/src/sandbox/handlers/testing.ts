// Test plumbing for the handler tests: a store over the committed seed in a `Map`-backed storage,
// a deterministic clock and id source, and `call()` to send requests to the handlers through the
// web app's shared MSW server (`src/test/server.ts`; a second `setupServer` would interfere).
import { server } from "../../test/server";
import seedJson from "../seed.json";
import type { SandboxSeed } from "../seed-types";
import { DEFAULT_SETTINGS, type SandboxSettings } from "../settings";
import { createSandboxStore, memoryStorage, SESSION_COOKIE } from "../store";
import type { HandlerContext } from "./context";
import { createSandboxHandlers } from "./index";

export const seed = seedJson as unknown as SandboxSeed;

export const USERS = {
  owner: "11111111-0000-4000-8000-a00000000001",
  admin: "11111111-0000-4000-8000-a00000000002",
  member: "11111111-0000-4000-8000-a00000000003",
  outsider: "11111111-0000-4000-8000-a00000000004",
} as const;

const survey = (n: number) => `22222222-0000-4000-8000-a0000000000${n}`;
export const SURVEYS = {
  feedback: survey(1),
  draft: survey(2),
  oldPoll: survey(3),
  campaign: survey(4),
  archivedCampaign: survey(5),
  retro: survey(6),
  quiz: survey(7),
} as const;

export const PROJECTS = {
  marketing: "55555555-0000-4000-8000-a00000000001",
  engineering: "55555555-0000-4000-8000-a00000000002",
} as const;

export const ORIGIN = "http://localhost";

export interface Sandbox {
  ctx: HandlerContext;
  /** Sends `method path` (path under `/api/v1`) as `user` (a user id, or none). */
  call(
    path: string,
    init?: {
      method?: string;
      user?: string | null;
      json?: unknown;
      headers?: Record<string, string>;
      body?: string;
    },
  ): Promise<Response>;
}

/** A store over the seed, the handlers registered on the shared MSW server, and a `call` helper. */
export function setupSandbox(settings: Partial<SandboxSettings> = {}): Sandbox {
  let clock = Date.parse("2026-08-01T00:00:00.000Z");
  let counter = 0;
  const ctx: HandlerContext = {
    store: createSandboxStore({
      storage: memoryStorage(),
      seed,
      settings: { ...DEFAULT_SETTINGS, ...settings },
    }),
    settings: { ...DEFAULT_SETTINGS, ...settings },
    origin: ORIGIN,
    now: () => new Date((clock += 1000)),
    newId: () => `99999999-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  };
  server.use(...createSandboxHandlers(ctx));
  return {
    ctx,
    call: (path, init = {}) => {
      const { method = "GET", user = null, json, headers = {}, body } = init;
      const sent = new Headers(headers);
      // MSW reads the `Cookie` header of the request under Node (in a browser, `document.cookie`).
      if (user !== null) sent.set("Cookie", `${SESSION_COOKIE}=${user}`);
      if (json !== undefined && !sent.has("Content-Type")) {
        sent.set("Content-Type", "application/json");
      }
      return fetch(`${ORIGIN}/api/v1${path}`, {
        method,
        headers: sent,
        ...(json !== undefined && { body: JSON.stringify(json) }),
        ...(body !== undefined && { body }),
      });
    },
  };
}
