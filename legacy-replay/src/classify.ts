// What the replay does with a sampled request (ADR 0041 point 3): it replays only a `GET` whose
// action the bridge's mapping table marks `effect: "read"`; everything else is skipped with its
// reason. A replayed action is paced under the strictest of Studio's per-address limits its
// `studio` operations fall under (`null`: none of them is limited per address).
import { matchAction } from "../../bridge/src/match.js";
import { rateLimitClassOf, type RateLimitClass } from "../../server/src/rate-limit-classes.js";
import type { SampleRow } from "./sample.js";

export type SkipReason = "write" | "forwarded" | "unknown-method";

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

export function classify(row: Pick<SampleRow, "method" | "path">): Classification {
  const method = row.method.toUpperCase();
  if (!KNOWN_METHODS.has(method)) return { kind: "skip", reason: "unknown-method" };
  // Only GET: a HEAD is forwarded, and the other methods may write.
  if (method !== "GET") return { kind: "skip", reason: "write" };
  const entry = matchAction(method, row.path);
  if (entry === undefined) return { kind: "skip", reason: "forwarded" };
  if (entry.effect !== "read") return { kind: "skip", reason: "write" };
  return { kind: "replay", action: entry.action, limit: strictestLimit(entry.studio) };
}
