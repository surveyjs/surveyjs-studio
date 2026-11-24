// The bridge's client of Studio's public API, typed with the contract's generated `paths`, so a
// breaking contract change fails the bridge's type check (ADR 0039 point 4).
import createClient, { type Client } from "openapi-fetch";
import type { paths } from "@surveyjs-studio/contract/types";
import type { BridgeMetrics } from "./metrics.js";
import type { BridgeSettings } from "./settings.js";

export type StudioClient = Client<paths>;

/**
 * A Studio answer the old API never gave (ADR 0039 point 5): `429` passes on as an empty `429`;
 * a network failure, a timeout or an unexpected status is an empty `500`.
 */
export class StudioFailure extends Error {
  constructor(
    readonly status: 429 | 500,
    message: string,
    options?: ErrorOptions & {
      /** A `429`'s `Retry-After` header as Studio sent it; `null` without one. */
      retryAfter?: string | null;
    },
  ) {
    super(message, options);
    this.name = "StudioFailure";
    this.retryAfter = options?.retryAfter ?? null;
  }

  readonly retryAfter: string | null;
}

/**
 * Studio refused the caller's credential (`401`: unknown, revoked, or its owner blocked). Thrown
 * only by a client that sends one; the action answers its bad-key answer (`key.ts`).
 */
export class KeyRefused extends Error {
  constructor() {
    super("Studio refused the access key");
    this.name = "KeyRefused";
  }
}

/** For a status the action does not map to an old answer: an empty `500`. */
export function unexpectedStatus(response: Response): never {
  throw new StudioFailure(500, `unexpected status ${response.status} from Studio`);
}

/** A timer that aborts `controller` after `ms`, holding the process open no longer than a call. */
function abortAfter(controller: AbortController, ms: number): NodeJS.Timeout {
  return setTimeout(
    () => controller.abort(new DOMException("The operation timed out.", "TimeoutError")),
    ms,
  ).unref();
}

/**
 * The response with its body's deadline `timer` cleared once the body has been read to its end,
 * has failed, or has been cancelled (the caller left), so no timer outlives the file it guards.
 */
export function withBodyDeadline(response: Response, timer: NodeJS.Timeout): Response {
  const source = response.body;
  if (source === null) {
    clearTimeout(timer);
    return response;
  }
  const reader = source.getReader();
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            clearTimeout(timer);
            controller.close();
          } else {
            controller.enqueue(value);
          }
        } catch (error) {
          clearTimeout(timer);
          controller.error(error);
        }
      },
      cancel(reason) {
        clearTimeout(timer);
        return reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export interface StudioClientOptions {
  /** Aborted when the caller goes away: its calls stop. */
  callerGone?: AbortSignal;
  /**
   * For file reads: only the answer's headers must come within `studioTimeoutMs`; its body then has
   * this long to arrive, so a large file streamed through is not cut off.
   */
  bodyTimeoutMs?: number;
  /**
   * The caller's access key or API token: every call carries `Authorization: Bearer <bearer>`,
   * and Studio's `401` throws a `KeyRefused`.
   */
  bearer?: string;
  /** Where each call is counted and timed (`studio_calls_total`, `studio_call_duration_seconds`). */
  metrics?: Pick<BridgeMetrics, "studioCalls" | "studioDuration">;
}

/** Why a Studio call has no answer: the call's deadline, the caller leaving, or anything else. */
function failureStatus(error: unknown, callerGone: AbortSignal | undefined): string {
  if ((error as { name?: unknown } | null)?.name === "TimeoutError") return "timeout";
  return callerGone?.aborted === true ? "aborted" : "network";
}

/**
 * A client for one caller: `callerIp` goes to Studio in `X-Forwarded-For` (Studio trusts it only
 * from the bridge, `TRUST_PROXY`); an unknown address (`""`) sends no such header, so Studio
 * counts the call against the bridge's own address. Each call, its answer's body included, must finish within
 * `studioTimeoutMs`, and stops when `callerGone` aborts. Studio's `429` and `5xx` throw a `StudioFailure`.
 */
export function studioClient(
  settings: Pick<BridgeSettings, "studioUrl" | "studioTimeoutMs">,
  callerIp: string,
  fetchImpl: (request: Request) => Promise<Response> = fetch,
  options: StudioClientOptions = {},
): StudioClient {
  const { callerGone, bodyTimeoutMs, bearer, metrics } = options;
  const send = async (request: Request): Promise<Response> => {
    const signals = [request.signal, ...(callerGone === undefined ? [] : [callerGone])];
    if (bodyTimeoutMs === undefined) {
      const signal = AbortSignal.any([...signals, AbortSignal.timeout(settings.studioTimeoutMs)]);
      return fetchImpl(new Request(request, { signal }));
    }
    const deadline = new AbortController();
    const headersTimer = abortAfter(deadline, settings.studioTimeoutMs);
    try {
      const signal = AbortSignal.any([...signals, deadline.signal]);
      const response = await fetchImpl(new Request(request, { signal }));
      clearTimeout(headersTimer);
      return withBodyDeadline(response, abortAfter(deadline, bodyTimeoutMs));
    } finally {
      clearTimeout(headersTimer);
    }
  };
  const headers: Record<string, string> = {};
  if (callerIp !== "") headers["x-forwarded-for"] = callerIp;
  if (bearer !== undefined) headers.authorization = `Bearer ${bearer}`;
  const client = createClient<paths>({ baseUrl: settings.studioUrl, headers, fetch: send });
  client.use({
    async onResponse({ response }) {
      if (bearer !== undefined && response.status === 401) {
        await response.body?.cancel();
        throw new KeyRefused();
      }
      if (response.status !== 429 && response.status < 500) return undefined;
      await response.body?.cancel();
      throw new StudioFailure(
        response.status === 429 ? 429 : 500,
        `Studio answered ${response.status}`,
        { retryAfter: response.headers.get("retry-after") },
      );
    },
  });
  if (metrics !== undefined) {
    // Used last, so its `onResponse` runs first (openapi-fetch runs them in reverse): every
    // answer is counted before the one above may throw.
    const calls = new Map<string, { operation: string; stop: () => void }>();
    const settle = (id: string, status: string): void => {
      const call = calls.get(id);
      if (call === undefined) return;
      calls.delete(id);
      call.stop();
      metrics.studioCalls.inc({ operation: call.operation, status });
    };
    client.use({
      onRequest({ request, schemaPath, id }) {
        const operation = `${request.method} ${schemaPath}`;
        calls.set(id, { operation, stop: metrics.studioDuration.startTimer({ operation }) });
        return undefined;
      },
      onResponse({ response, id }) {
        settle(id, String(response.status));
        return undefined;
      },
      onError({ error, id }) {
        settle(id, failureStatus(error, callerGone));
        return undefined;
      },
    });
  }
  return client;
}
