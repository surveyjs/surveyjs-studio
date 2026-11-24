// The old API's access key (ADR 0040 point 2): read from the query (the sign-in actions) or bound
// as the old API bound it (the "text" actions), sent to Studio only as `Authorization: Bearer`,
// never logged and never put in an answer header. Each keyed action has a bad-key answer (its
// `KeyRule`): for a missing or empty key, given without asking Studio, and for a key Studio
// refuses (`401`: unknown, revoked, or its owner blocked).
import type {
  FastifyReply,
  FastifyRequest,
  onRequestAsyncHookHandler,
  RouteHandlerMethod,
} from "fastify";
import { htmlEncode, sendEmpty, sendText } from "./answers.js";
import { boundValue } from "./binding.js";
import { contextOf } from "./context.js";
import { queryValue } from "./routes.js";
import type { BridgeSettings } from "./settings.js";
import { KeyRefused, studioClient, type StudioClient } from "./studio.js";

/**
 * How an action answers a bad key, as the old API did (ADR 0040 point 2), but for what ADR 0040
 * point 1 changes:
 * - `none`: the action takes no key;
 * - `authorize`: an empty `401`, without the old sign-in `Location` (it carried the key);
 * - `text`: `200 text/html` "The accessKey '…' is incorrect.", the key HTML-encoded;
 * - `key-401`: an empty `401` (`POST clone`, which only the key could sign in).
 */
export type KeyRule = "none" | "authorize" | "text" | "key-401";

/** What an access key or API token can be: visible ASCII, which a header carries unchanged. */
const CREDENTIAL = /^[\x21-\x7e]+$/;

/**
 * The `accessKey` query parameter as the old API read it: the name in any letter case, the first
 * value, decoded. `undefined` when it is missing or empty.
 */
export function accessKeyOf(request: FastifyRequest): string | undefined {
  const key = queryValue(request, "accessKey");
  return key === "" ? undefined : key;
}

/**
 * Where a keyed action reads its key: `query`, as the old sign-in scheme did (the `authorize` and
 * `key-401` actions, and `exportSurveyResults`); `bound`, as the old API bound any other simple
 * parameter: a form body's field first, then the query (the other `text` actions).
 */
export type KeySource = "query" | "bound";

/** The key a `bound` action read, by request. */
const boundKeys = new WeakMap<FastifyRequest, string>();

/**
 * The request's key as its action reads it: the bound one for a `bound` action (after
 * `withKeyRule` read it), else {@link accessKeyOf}. `undefined` when it is missing or empty.
 */
export function keyOf(request: FastifyRequest): string | undefined {
  const key = boundKeys.get(request) ?? accessKeyOf(request);
  return key === "" ? undefined : key;
}

/** The action's bad-key answer for `key` (`""` when there was none). */
export function sendBadKey(reply: FastifyReply, rule: KeyRule, key: string): FastifyReply {
  switch (rule) {
    case "authorize":
    case "key-401":
      return sendEmpty(reply, 401);
    case "text":
      return sendText(reply, `The accessKey '${htmlEncode(key)}' is incorrect.`);
    case "none":
      throw new Error("an action that takes no key has no bad-key answer");
  }
}

/**
 * Studio's public API on behalf of the caller, as `request.studio`, with `key` (by default the
 * request's own key, {@link keyOf}) as `Authorization: Bearer`. Studio's `401` then throws a
 * `KeyRefused`, which `withKeyRule` answers with the action's bad-key answer.
 */
export function studioFor(
  request: FastifyRequest,
  settings: Pick<BridgeSettings, "studioUrl" | "studioTimeoutMs">,
  key: string | undefined = keyOf(request),
): StudioClient {
  return studioClient(
    settings,
    request.callerIp,
    contextOf(request).studioFetch,
    request.callerGone,
    undefined,
    key,
  );
}

/**
 * The handler of an action with key rule `rule`, its key read from `source` (by default `bound`
 * for a `text` action, `query` for the others): a missing or empty key, or one no credential can
 * be, gets the bad-key answer before the handler runs (so no Studio call), and a `KeyRefused`
 * from the handler's Studio calls gets it too.
 */
export function withKeyRule(
  rule: KeyRule,
  handler: RouteHandlerMethod,
  source: KeySource = rule === "text" ? "bound" : "query",
): RouteHandlerMethod {
  if (rule === "none") return handler;
  return async function keyed(this: unknown, request, reply) {
    let key: string;
    if (source === "bound") {
      key = (await boundValue(request, "accessKey")) ?? "";
      boundKeys.set(request, key);
    } else {
      key = queryValue(request, "accessKey") ?? "";
    }
    if (!CREDENTIAL.test(key)) return sendBadKey(reply, rule, key);
    try {
      return await (handler as (...args: unknown[]) => unknown).call(this, request, reply);
    } catch (error) {
      if (error instanceof KeyRefused && !reply.sent) return sendBadKey(reply, rule, key);
      throw error;
    }
  } as RouteHandlerMethod;
}

/**
 * Before the body is read: the bad-key answer for a missing or empty key, or one no credential
 * can be, on the actions that need sign-in (`authorize`, `key-401`), as the old API challenged
 * them before reading any parameter. `undefined` for the other rules, which check in the handler.
 */
export function keyGate(rule: KeyRule): onRequestAsyncHookHandler | undefined {
  if (rule !== "authorize" && rule !== "key-401") return undefined;
  return async function gate(request, reply) {
    const key = queryValue(request, "accessKey") ?? "";
    if (!CREDENTIAL.test(key)) return sendBadKey(reply, rule, key);
    return undefined;
  };
}

/** A request URL with each `accessKey` value (name in any letter case) replaced, for logs. */
export function withoutKey(url: string): string {
  const start = url.indexOf("?");
  if (start < 0) return url;
  const parameters = url
    .slice(start + 1)
    .split("&")
    .map((parameter) => {
      // The name as `queryValues` decodes it.
      const [name] = new URLSearchParams(parameter).keys();
      if (name?.toLowerCase() !== "accesskey") return parameter;
      const equals = parameter.indexOf("=");
      return `${equals < 0 ? parameter : parameter.slice(0, equals)}=[redacted]`;
    });
  return `${url.slice(0, start)}?${parameters.join("&")}`;
}
