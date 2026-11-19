// The bridge's client of Studio's public API, typed with the contract's generated `paths`, so a
// breaking contract change fails the bridge's type check (ADR 0039 point 4).
import createClient, { type Client } from "openapi-fetch";
import type { paths } from "@surveyjs-studio/contract/types";
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
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioFailure";
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
 * A client for one caller: `callerIp` goes to Studio in `X-Forwarded-For` (Studio trusts it only
 * from the bridge, `TRUST_PROXY`). Each call, its answer's body included, must finish within
 * `studioTimeoutMs`, and stops when `callerGone` aborts. Studio's `429` and `5xx` throw a `StudioFailure`.
 *
 * With `bodyTimeoutMs` (file reads), only the answer's headers must come within `studioTimeoutMs`;
 * its body then has `bodyTimeoutMs` to arrive, so a large file streamed through is not cut off.
 */
export function studioClient(
  settings: Pick<BridgeSettings, "studioUrl" | "studioTimeoutMs">,
  callerIp: string,
  fetchImpl: (request: Request) => Promise<Response> = fetch,
  callerGone?: AbortSignal,
  bodyTimeoutMs?: number,
): StudioClient {
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
      abortAfter(deadline, bodyTimeoutMs);
      return response;
    } finally {
      clearTimeout(headersTimer);
    }
  };
  const client = createClient<paths>({
    baseUrl: settings.studioUrl,
    headers: { "x-forwarded-for": callerIp },
    fetch: send,
  });
  client.use({
    async onResponse({ response }) {
      if (response.status !== 429 && response.status < 500) return undefined;
      await response.body?.cancel();
      throw new StudioFailure(
        response.status === 429 ? 429 : 500,
        `Studio answered ${response.status}`,
      );
    },
  });
  return client;
}
