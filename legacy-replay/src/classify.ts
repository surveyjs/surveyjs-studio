// What the replay does with a sampled request (ADR 0041 point 3): it replays only a `GET` whose
// action the bridge's mapping table marks `effect: "read"`; everything else is skipped with its
// reason. A replayed action is paced under the strictest of Studio's per-address limits its
// `studio` operations fall under (`null`: none of them is limited per address). The path is judged
// as recorded and as fetch will send it, which resolves dot segments and backslashes.
import { matchAction } from "../../bridge/src/match.js";
import { rateLimitClassOf, type RateLimitClass } from "../../server/src/rate-limit-classes.js";
import type { SampleRow } from "./sample.js";

export type SkipReason = "write" | "forwarded" | "unknown-method" | "unsafe-path";

export type Classification =
  | { kind: "replay"; action: string; limit: RateLimitClass | null }
  | { kind: "skip"; reason: SkipReason };

/** The methods the bridge's router knows (mapping.ts `ANY_METHOD`). */
const KNOWN_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
]);

/** The classes from the fewest requests a minute allowed to the most (Studio's defaults: 10, 60, 600). */
const STRICTEST_FIRST: readonly RateLimitClass[] = ["summary", "public", "file"];

/** The strictest limit class among `operations`, or `null` when none is limited per address. */
export function strictestLimit(operations: readonly string[]): RateLimitClass | null {
  const classes = new Set(operations.map(rateLimitClassOf));
  return STRICTEST_FIRST.find((limitClass) => classes.has(limitClass)) ?? null;
}

/**
 * The URL fetch sends for `row` at `base` (an origin): parsed as WHATWG URLs are, so dot segments
 * (`..`, `%2E%2E`) are resolved and a backslash is a slash. `undefined` when it does not parse or
 * leaves `base`'s origin.
 */
export function requestUrl(base: string, row: Pick<SampleRow, "path" | "query">): URL | undefined {
  const origin = new URL(base).origin;
  let url: URL;
  try {
    url = new URL(row.path + (row.query === "" ? "" : `?${row.query}`), origin);
  } catch {
    return undefined;
  }
  return url.origin === origin ? url : undefined;
}

/** Any origin: dot segments resolve the same on every one. */
const SOME_ORIGIN = "http://replay.invalid";

/**
 * The paths the replay may send: segments of letters, digits, `_`, `-`, `{` and `}` (action names,
 * and ids as GUIDs with or without dashes or braces), one trailing slash allowed. Nothing a host
 * could decode or normalise into another path: no `%`, `\`, `.`, `;`, `?`, `#`, space or control
 * character, and no empty segment.
 */
const SAFE_PATH = /^(?:\/[A-Za-z0-9_{}-]+)+\/?$/;

/** A query fetch sends as recorded: no fragment (`#`), no control character. */
function isSafeQuery(query: string): boolean {
  for (const char of query) {
    const code = char.charCodeAt(0);
    if (char === "#" || code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/** Whether the recorded request is on the allowlist the replay may send (`SAFE_PATH`). */
export function isSafeRequest(row: { path: string; query?: string }): boolean {
  return SAFE_PATH.test(row.path) && isSafeQuery(row.query ?? "");
}

/** Whether `url` (from `requestUrl`) is still a GET of the read `action`. */
export function sendsAction(url: URL | undefined, action: string): boolean {
  const sent = url && classifyPath("GET", url.pathname);
  return sent?.kind === "replay" && sent.action === action;
}

function classifyPath(method: string, path: string): Classification {
  const entry = matchAction(method, path);
  if (entry === undefined) return { kind: "skip", reason: "forwarded" };
  if (entry.effect !== "read") return { kind: "skip", reason: "write" };
  return { kind: "replay", action: entry.action, limit: strictestLimit(entry.studio) };
}

/**
 * Replays a GET of a read action whose recorded request is on the allowlist (`isSafeRequest`,
 * checked first: `unsafe-path`); as a second guard, the path fetch sends (`requestUrl`) must be the
 * same action, else it is a `write`, never sent.
 */
export function classify(
  row: Pick<SampleRow, "method" | "path"> & { query?: string },
): Classification {
  if (!isSafeRequest(row)) return { kind: "skip", reason: "unsafe-path" };
  const method = row.method.toUpperCase();
  if (!KNOWN_METHODS.has(method)) return { kind: "skip", reason: "unknown-method" };
  // Only GET: a HEAD is forwarded, and the other methods may write.
  if (method !== "GET") return { kind: "skip", reason: "write" };
  const recorded = classifyPath(method, row.path);
  if (recorded.kind !== "replay") return recorded;
  if (!sendsAction(requestUrl(SOME_ORIGIN, { path: row.path, query: "" }), recorded.action)) {
    return { kind: "skip", reason: "write" };
  }
  return recorded;
}
