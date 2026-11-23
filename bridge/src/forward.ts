// Forwarding to the old service (ADR 0035 point 5, ADR 0039 point 4): the site's paths and every
// path the route table does not hold go there with method, path, query, headers (but hop-by-hop
// ones) and body unchanged, and its answer comes back unchanged. Bodies are streamed both ways.
// Node's http client rather than fetch: fetch may not set Host and decodes compressed bodies.
import {
  Agent as HttpAgent,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { pipeline } from "node:stream";
import type { FastifyBaseLogger } from "fastify";

/** No answer, and no bytes of one, for this long: the old service is taken as failed. */
export const FORWARD_TIMEOUT_MS = 120_000;

/** The largest header block the bridge accepts, and reads from the old service. */
export const MAX_HEADER_BYTES = 32 * 1024;

/** Headers of one connection, never forwarded (RFC 9110 §7.6.1), whichever way. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Headers `Connection` may never remove: the message's framing and the headers the bridge sets
 * itself. Otherwise a caller naming `Content-Length` there could send a body unframed and smuggle
 * a second request to the old service.
 */
const PROTECTED = new Set(["content-length", "transfer-encoding", "host", "x-forwarded-for"]);

/**
 * The headers of a raw list (`[name, value, …]`) that may be forwarded: without the hop-by-hop
 * ones, those the `Connection` header names (but the protected ones), and `drop` (lower-case).
 */
export function endToEndHeaders(rawHeaders: string[], drop: readonly string[] = []): string[] {
  const named = new Set<string>(drop);
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i]!.toLowerCase() === "connection") {
      for (const token of rawHeaders[i + 1]!.split(",")) {
        const name = token.trim().toLowerCase();
        if (!PROTECTED.has(name)) named.add(name);
      }
    }
  }
  const kept: string[] = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i]!.toLowerCase();
    if (!HOP_BY_HOP.has(name) && !named.has(name)) kept.push(rawHeaders[i]!, rawHeaders[i + 1]!);
  }
  return kept;
}

/**
 * The path and query to send on, as the bytes received: an origin-form target as it is; an
 * absolute-form one (`http://host/path?q`) without its scheme and authority. `undefined` for any
 * other target (`*`, `http://`, garbage), which the bridge answers with an empty `400`.
 */
export function originTarget(url: string | undefined): string | undefined {
  if (url === undefined || url === "") return undefined;
  if (url.startsWith("/")) return url;
  const absolute = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]+([/?][^#]*)?$/.exec(url);
  if (absolute === null) return undefined;
  const rest = absolute[1] ?? "";
  return rest.startsWith("/") ? rest : `/${rest}`;
}

/**
 * How the request's body is framed, as Node's parser read it: `"chunked"`, its length as a plain
 * decimal (`088` → `88`), `"none"`, or `"invalid"` for a transfer coding other than chunked,
 * which the bridge does not pass on (empty `400`).
 */
export function requestFraming(req: IncomingMessage): "chunked" | "none" | "invalid" | string {
  const te = req.headers["transfer-encoding"];
  if (te !== undefined) {
    const codings = te
      .split(",")
      .map((coding) => coding.trim().toLowerCase())
      .filter((coding) => coding !== "");
    const plain =
      codings.length === 1
        ? codings[0] === "chunked"
        : codings.length === 2 && codings[0] === "identity" && codings[1] === "chunked";
    return plain ? "chunked" : "invalid";
  }
  const length = req.headers["content-length"];
  if (length === undefined) return "none";
  return /^[0-9]+$/.test(length) ? BigInt(length).toString() : "invalid";
}

/** An IPv4 address mapped into IPv6 (`::ffff:192.0.2.1`) in its IPv4 form. */
export function plainAddress(address: string | undefined): string {
  if (address === undefined) return "";
  return /^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(address) ? address.slice(7) : address;
}

/** Why a forwarded request got no complete answer from the old service. */
export type ForwardFailure = "timeout" | "network" | "aborted";

export interface ForwarderOptions {
  /** No answer, and no bytes of one, for this long: the old service is taken as failed. */
  timeoutMs?: number;
  /**
   * Called once for a forwarded request without a complete answer, when the caller's answer
   * closes: `timeout` (the old service sent nothing for `timeoutMs`), `network` (it could not be
   * reached, or its answer broke off or could not be passed on) or `aborted` (the caller went away
   * first).
   */
  onFailure?: (reason: ForwardFailure) => void;
}

export interface Forwarder {
  /**
   * Sends the request to the old service and streams its answer into `res`. `peer` is appended to
   * `X-Forwarded-For`. A failure before the answer starts is an empty `500` (with
   * `Access-Control-Allow-Origin: *` when `cors`), as the old API's unhandled errors.
   */
  forward(
    req: IncomingMessage,
    res: ServerResponse,
    options: { peer: string; cors: boolean; log: FastifyBaseLogger },
  ): void;
  close(): void;
}

export function createForwarder(legacyUrl: string, options: ForwarderOptions = {}): Forwarder {
  const { timeoutMs = FORWARD_TIMEOUT_MS, onFailure } = options;
  const base = new URL(legacyUrl);
  const https = base.protocol === "https:";
  // Idle connections are kept for 5 s, as Node's own default agent does.
  const agentOptions = { keepAlive: true, timeout: 5_000 };
  const agent = https ? new HttpsAgent(agentOptions) : new HttpAgent(agentOptions);
  const send = https ? httpsRequest : httpRequest;
  const basePath = base.pathname.replace(/\/$/, "");

  function fail(res: ServerResponse, cors: boolean, status: 400 | 500 = 500): void {
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(status, {
      "content-length": "0",
      ...(cors && { "access-control-allow-origin": "*" }),
    });
    res.end();
  }

  return {
    forward(req, res, { peer, cors, log }) {
      const target = originTarget(req.url);
      if (target === undefined) {
        fail(res, cors, 400);
        return;
      }

      // Host is the old service's; Expect was answered by this server already; the framing is
      // this hop's own, from what Node's parser read (below).
      const headers = endToEndHeaders(req.rawHeaders, [
        "host",
        "expect",
        "x-forwarded-for",
        "content-length",
      ]);
      const forwardedFor = [req.headers["x-forwarded-for"], peer]
        .filter((part) => part !== undefined && part !== "")
        .join(", ");
      headers.unshift("Host", base.host);
      headers.push("X-Forwarded-For", forwardedFor);
      const framing = requestFraming(req);
      if (framing === "invalid") {
        fail(res, cors, 400);
        return;
      }
      if (framing === "chunked") headers.push("Transfer-Encoding", "chunked");
      else if (framing !== "none") headers.push("Content-Length", framing);

      let upstream: ReturnType<typeof send> | undefined;
      // What went wrong, settled once the caller's answer closes.
      let timedOut = false;
      let oldServiceFailed = false;
      res.once("close", () => {
        const complete = res.writableFinished;
        if (timedOut) onFailure?.("timeout");
        else if (oldServiceFailed) onFailure?.("network");
        else if (!complete) onFailure?.("aborted");
        // The caller went away before the answer was complete: stop the old service's request too.
        if (!complete) upstream?.destroy();
      });

      try {
        upstream = send({
          protocol: base.protocol,
          hostname: base.hostname,
          port: base.port,
          servername: https ? base.hostname : undefined,
          method: req.method,
          path: `${basePath}${target}`,
          headers,
          agent,
          // As the bridge's own server: the old host took 32 KB of headers.
          maxHeaderSize: MAX_HEADER_BYTES,
        });
      } catch (error) {
        log.error({ err: error }, "cannot forward to the old service");
        oldServiceFailed = true;
        fail(res, cors);
        return;
      }

      const outgoing = upstream;
      outgoing.setTimeout(timeoutMs, () => {
        timedOut = true;
        outgoing.destroy(new Error(`the old service sent nothing for ${timeoutMs} ms`));
      });
      outgoing.on("response", (answer) => {
        try {
          res.writeHead(
            answer.statusCode ?? 500,
            answer.statusMessage,
            endToEndHeaders(answer.rawHeaders),
          );
        } catch (error) {
          log.error({ err: error }, "the old service's answer cannot be passed on");
          oldServiceFailed = true;
          answer.destroy();
          outgoing.destroy();
          fail(res, cors);
          return;
        }
        // The old service's answer broke off (set before the pipeline closes the caller's answer).
        answer.once("error", () => (oldServiceFailed = true));
        // The pipeline adds seven "close" listeners to those of the bridge's hooks (metrics, the
        // action's caller-gone signal); Node would warn past ten, though none of them leaks.
        res.setMaxListeners(20);
        pipeline(answer, res, (error) => {
          if (error) {
            log.warn({ err: error }, "forwarded answer interrupted");
            res.destroy();
          }
        });
      });
      outgoing.on("error", (error) => {
        // The caller went away (above): nothing to answer.
        if (res.destroyed || res.writableEnded) return;
        oldServiceFailed = true;
        log.error({ err: error }, "forwarding to the old service failed");
        fail(res, cors);
      });
      // pipe, not pipeline: a failed request must not destroy the caller's socket before the 500.
      req.on("error", (error) => outgoing.destroy(error));
      req.pipe(outgoing);
    },
    close() {
      agent.destroy();
    },
  };
}
