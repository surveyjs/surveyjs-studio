// The replay itself (ADR 0041 point 3): each sampled read goes to the old service, then to the
// bridge, then to the old service again, one request at a time. Only what `classify` replays is
// ever sent, always as a `GET` that follows no redirect. The key a request carries is replayed as
// recorded but never leaves this module: a result holds the request with each key replaced by its
// hash prefix, and every text taken from an answer or an error has the key scrubbed the same way.
import { keyHashPrefix } from "../../bridge/src/callers.js";
import { classify } from "./classify.js";
import { compareAnswers, type Answer, type Difference } from "./compare.js";
import type { Pacer } from "./pace.js";
import type { SampleRow } from "./sample.js";

export type Outcome = "same" | "different" | "changed" | "rate-limited" | "error";

export const OUTCOMES: readonly Outcome[] = [
  "same",
  "different",
  "changed",
  "rate-limited",
  "error",
];

export interface CaseResult {
  /** The sampled request, each `accessKey` value replaced by `<hash prefix>…`. */
  row: SampleRow;
  action: string;
  /**
   * `same`/`different`: the bridge's answer compared with the old service's; `changed`: the old
   * service's two answers differ (the data moved between the calls); `rate-limited`: the bridge
   * answered `429` twice; `error`: a request failed.
   */
  outcome: Outcome;
  differences: Difference[];
  /** The hash prefix of the request's key (`keyOf`: the first `accessKey`), when it has one. */
  keyPrefix?: string;
  /** Why the case is an `error`, keys scrubbed. */
  error?: string;
}

export interface ReplayOptions {
  oldUrl: string;
  bridgeUrl: string;
  pacer: Pacer;
  fetch?: typeof globalThis.fetch;
  /** Waits out a `Retry-After`. */
  sleep?: (ms: number) => Promise<void>;
}

/** How long one request may take: an export of many results is slow. */
const REQUEST_TIMEOUT_MS = 120_000;
/** The wait after a `429` without a `Retry-After` in seconds. */
const DEFAULT_RETRY_AFTER_S = 60;

const isKeyName = (name: string | undefined) => name?.toLowerCase() === "accesskey";

/** Every `accessKey` value of a query (name in any letter case), decoded, in order. */
function keysOf(query: string): string[] {
  return [...new URLSearchParams(query)]
    .filter(([name]) => isKeyName(name))
    .map(([, value]) => value);
}

const masked = (key: string) => `${keyHashPrefix(key)}…`;

/** The query with each `accessKey` value replaced by its hash prefix, the rest as recorded. */
function withKeysMasked(query: string): string {
  if (query === "") return query;
  return query
    .split("&")
    .map((parameter) => {
      const [[name, value] = []] = new URLSearchParams(parameter);
      if (!isKeyName(name)) return parameter;
      const equals = parameter.indexOf("=");
      const rawName = equals < 0 ? parameter : parameter.slice(0, equals);
      return `${rawName}=${value ? masked(value) : ""}`;
    })
    .join("&");
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replaces each key, as sent, URL-encoded or HTML-encoded and in any letter case, by its mask. */
function scrubberOf(keys: readonly string[]): <T>(value: T) => T {
  const rules = keys.map((key) => {
    const html = key.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
    const variants = new Set([
      key,
      encodeURIComponent(key),
      html,
      key
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;"),
    ]);
    const pattern = new RegExp([...variants].map(escapeRegExp).join("|"), "gi");
    return { pattern, mask: masked(key) };
  });
  const text = (value: string) =>
    rules.reduce((result, rule) => result.replace(rule.pattern, rule.mask), value);
  const scrub = (value: unknown): unknown => {
    if (typeof value === "string") return text(value);
    if (Array.isArray(value)) return value.map(scrub);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([name, inner]) => [text(name), scrub(inner)]),
      );
    }
    return value;
  };
  return scrub as <T>(value: T) => T;
}

function describeError(error: unknown): string {
  const text = String(error);
  const cause =
    error instanceof Error && error.cause !== undefined ? ` (${String(error.cause)})` : "";
  return text + cause;
}

async function readAnswer(response: Response): Promise<Answer> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => (headers[name] = value));
  return { status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) };
}

function retryAfterMs(answer: Answer): number {
  const value = answer.headers["retry-after"]?.trim() ?? "";
  return (/^\d+$/.test(value) ? Number(value) : DEFAULT_RETRY_AFTER_S) * 1000;
}

/** Replays each row `classify` replays, in order; the other rows are not sent and not yielded. */
export async function* replay(
  rows: Iterable<SampleRow>,
  options: ReplayOptions,
): AsyncIterable<CaseResult> {
  const fetch = options.fetch ?? globalThis.fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const oldBase = options.oldUrl.replace(/\/+$/, "");
  const bridgeBase = options.bridgeUrl.replace(/\/+$/, "");

  for (const row of rows) {
    const classification = classify(row);
    if (classification.kind !== "replay") continue;
    const { action, limit } = classification;
    // A path the mapping table matches starts with `/`, so it stays on the base URL's host.
    const target = row.path + (row.query === "" ? "" : `?${row.query}`);
    const get = async (base: string) =>
      readAnswer(
        await fetch(base + target, {
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
      );
    const keys = keysOf(row.query);
    const scrub = scrubberOf(keys.filter((key) => key !== ""));
    const result = (outcome: Outcome, differences: Difference[] = [], error?: string) => {
      const out: CaseResult = {
        row: { ...row, query: withKeysMasked(row.query) },
        action,
        outcome,
        differences: scrub(differences),
      };
      // The request's key as the bridge reads it (`accessKeyOf`): the first value, if not empty.
      if (keys[0]) out.keyPrefix = keyHashPrefix(keys[0]);
      if (error !== undefined) out.error = scrub(error);
      return out;
    };

    try {
      const firstOld = await get(oldBase);
      await options.pacer(limit);
      let bridge = await get(bridgeBase);
      if (bridge.status === 429) {
        await sleep(retryAfterMs(bridge));
        await options.pacer(limit);
        bridge = await get(bridgeBase);
        if (bridge.status === 429) {
          yield result("rate-limited");
          continue;
        }
      }
      const secondOld = await get(oldBase);
      if (compareAnswers(firstOld, secondOld, action).length > 0) {
        yield result("changed");
        continue;
      }
      const differences = compareAnswers(firstOld, bridge, action);
      yield result(differences.length === 0 ? "same" : "different", differences);
    } catch (error) {
      yield result("error", [], describeError(error));
    }
  }
}
