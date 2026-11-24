// The replay itself (ADR 0041 point 3): each sampled read goes to the old service, then to the
// bridge, then to the old service again, one request at a time. Only what `classify` replays is
// ever sent, at the URL fetch sends only when that is still the same action (dot segments and
// backslashes resolved), always as a `GET` that follows no redirect. The key a request carries is
// replayed as recorded but never leaves this module: a result holds the request with each key
// replaced by its hash prefix, answers are scrubbed of the key before they are compared, and so
// are the differences and errors.
import { keyHashPrefix } from "../../bridge/src/callers.js";
import { classify, isSafeRequest, requestUrl, sendsAction } from "./classify.js";
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
/**
 * The shortest key masked in answers: a shorter one (`accessKey=1`) is no credential and would mask
 * unrelated text. It is still masked in the request and in errors.
 */
const MIN_SCRUBBED_KEY = 8;
/** The wait after a `429` without a `Retry-After` in seconds. */
const DEFAULT_RETRY_AFTER_S = 60;

const isKeyName = (name: string | undefined) => name?.toLowerCase() === "accesskey";

/** Every `accessKey` parameter of a query (name in any letter case), in order: decoded and as recorded. */
function keysOf(query: string): { key: string; recorded: string }[] {
  if (query === "") return [];
  return query.split("&").flatMap((parameter) => {
    const [[name, key] = []] = new URLSearchParams(parameter);
    if (!isKeyName(name) || key === undefined) return [];
    const equals = parameter.indexOf("=");
    return [{ key, recorded: equals < 0 ? "" : parameter.slice(equals + 1) }];
  });
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

/** A string whose characters are `text`'s UTF-8 bytes, to search bytes read as `latin1`. */
const asBytes = (text: string) => Buffer.from(text, "utf8").toString("latin1");

export interface Scrubber {
  /** Strings, array items and object keys and values, with each key masked. */
  value<T>(value: T): T;
  /** An answer with each key masked in its headers and body bytes (the same on every answer). */
  answer(answer: Answer): Answer;
}

/**
 * Masks each key: decoded, as recorded in the query, URL-encoded or HTML-encoded, in any letter
 * case. Answers are scrubbed before they are compared, so no window cut around a difference can
 * hold part of a key.
 */
export function scrubberOf(keys: readonly { key: string; recorded: string }[]): Scrubber {
  const rules = keys
    .filter(({ key }) => key !== "")
    .map(({ key, recorded }) => {
      const variants = new Set(
        [
          key,
          recorded,
          encodeURIComponent(key),
          key.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`),
          key
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#x27;"),
        ].filter((variant) => variant !== ""),
      );
      const alternatives = (map: (text: string) => string) =>
        new RegExp([...variants].map((variant) => escapeRegExp(map(variant))).join("|"), "gi");
      return {
        text: alternatives((variant) => variant),
        bytes: alternatives(asBytes),
        mask: masked(key),
      };
    });
  const text = (value: string) =>
    rules.reduce((result, rule) => result.replace(rule.text, rule.mask), value);
  const bytes = (body: Buffer) => {
    if (rules.length === 0) return body;
    const latin1 = rules.reduce(
      (result, rule) => result.replace(rule.bytes, asBytes(rule.mask)),
      body.toString("latin1"),
    );
    return Buffer.from(latin1, "latin1");
  };
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
  return {
    value: scrub as <T>(value: T) => T,
    answer: (answer) => ({
      status: answer.status,
      headers: Object.fromEntries(
        Object.entries(answer.headers).map(([name, value]) => [name, text(value)]),
      ),
      body: bytes(answer.body),
    }),
  };
}

export function describeError(error: unknown): string {
  const text = String(error);
  const cause =
    error instanceof Error && error.cause !== undefined ? ` (${String(error.cause)})` : "";
  return text + cause;
}

export async function readAnswer(response: Response): Promise<Answer> {
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

  for (const row of rows) {
    const classification = classify(row);
    if (classification.kind !== "replay") continue;
    const { action, limit } = classification;
    // The URL as fetch sends it must still be the classified action (dot segments, backslashes).
    const oldTarget = requestUrl(options.oldUrl, row);
    const bridgeTarget = requestUrl(options.bridgeUrl, row);
    if (
      !isSafeRequest(row) ||
      !oldTarget ||
      !bridgeTarget ||
      !sendsAction(oldTarget, action) ||
      !sendsAction(bridgeTarget, action)
    ) {
      continue;
    }
    const keys = keysOf(row.query);
    // Answers and differences: only keys long enough not to mask unrelated text. Errors: every key.
    const scrub = scrubberOf(keys.filter(({ key }) => key.length >= MIN_SCRUBBED_KEY));
    const scrubAll = scrubberOf(keys);
    const get = async (url: URL) =>
      scrub.answer(
        await readAnswer(
          await fetch(url.href, {
            method: "GET",
            redirect: "manual",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }),
        ),
      );
    const result = (outcome: Outcome, differences: Difference[] = [], error?: string) => {
      const out: CaseResult = {
        row: { ...row, query: withKeysMasked(row.query) },
        action,
        outcome,
        differences: scrub.value(differences),
      };
      // The request's key as the bridge reads it (`accessKeyOf`): the first value, if not empty.
      if (keys[0]?.key) out.keyPrefix = keyHashPrefix(keys[0].key);
      if (error !== undefined) out.error = scrubAll.value(error);
      return out;
    };

    try {
      const firstOld = await get(oldTarget);
      await options.pacer(limit);
      let bridge = await get(bridgeTarget);
      if (bridge.status === 429) {
        await sleep(retryAfterMs(bridge));
        await options.pacer(limit);
        bridge = await get(bridgeTarget);
        if (bridge.status === 429) {
          yield result("rate-limited");
          continue;
        }
      }
      const secondOld = await get(oldTarget);
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
