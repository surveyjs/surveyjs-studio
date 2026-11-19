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
 * The headers of a raw list (`[name, value, …]`) that may be forwarded: without the hop-by-hop
 * ones, those the `Connection` header names, and `drop` (lower-case names).
 */
export function endToEndHeaders(rawHeaders: string[], drop: readonly string[] = []): string[] {
  const named = new Set<string>(drop);
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i]!.toLowerCase() === "connection") {
      for (const token of rawHeaders[i + 1]!.split(",")) named.add(token.trim().toLowerCase());
    }
  }
  const kept: string[] = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i]!.toLowerCase();
    if (!HOP_BY_HOP.has(name) && !named.has(name)) kept.push(rawHeaders[i]!, rawHeaders[i + 1]!);
  }
  return kept;
}

/** An IPv4 address mapped into IPv6 (`::ffff:192.0.2.1`) in its IPv4 form. */
export function plainAddress(address: string | undefined): string {
  if (address === undefined) return "";
  return /^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(address) ? address.slice(7) : address;
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

export function createForwarder(legacyUrl: string, timeoutMs = FORWARD_TIMEOUT_MS): Forwarder {
  const base = new URL(legacyUrl);
  const https = base.protocol === "https:";
  // Idle connections are kept for 5 s, as Node's own default agent does.
  const agentOptions = { keepAlive: true, timeout: 5_000 };
  const agent = https ? new HttpsAgent(agentOptions) : new HttpAgent(agentOptions);
  const send = https ? httpsRequest : httpRequest;
  const basePath = base.pathname.replace(/\/$/, "");

  function fail(res: ServerResponse, cors: boolean): void {
    if (res.destroyed) return;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(500, {
      "content-length": "0",
      ...(cors && { "access-control-allow-origin": "*" }),
    });
    res.end();
  }

  return {
    forward(req, res, { peer, cors, log }) {
      // The request target as received; an absolute form keeps its path and query only.
      const target = (req.url ?? "/").startsWith("/")
        ? (req.url ?? "/")
        : (() => {
            const url = new URL(req.url ?? "/");
            return `${url.pathname}${url.search}`;
          })();

      // Host is the old service's; Expect was answered by this server already.
      const headers = endToEndHeaders(req.rawHeaders, ["host", "expect", "x-forwarded-for"]);
      const forwardedFor = [req.headers["x-forwarded-for"], peer]
        .filter((part) => part !== undefined && part !== "")
        .join(", ");
      headers.unshift("Host", base.host);
      headers.push("X-Forwarded-For", forwardedFor);
      // A body of unknown length is sent in chunks of this hop's own.
      if (
        req.headers["content-length"] === undefined &&
        req.headers["transfer-encoding"] !== undefined
      ) {
        headers.push("Transfer-Encoding", "chunked");
      }

      let upstream: ReturnType<typeof send>;
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
        });
      } catch (error) {
        log.error({ err: error }, "cannot forward to the old service");
        fail(res, cors);
        return;
      }

      upstream.setTimeout(timeoutMs, () => {
        upstream.destroy(new Error(`the old service sent nothing for ${timeoutMs} ms`));
      });
      upstream.on("response", (answer) => {
        res.writeHead(
          answer.statusCode ?? 500,
          answer.statusMessage,
          endToEndHeaders(answer.rawHeaders),
        );
        pipeline(answer, res, (error) => {
          if (error) {
            log.warn({ err: error }, "forwarded answer interrupted");
            res.destroy();
          }
        });
      });
      upstream.on("error", (error) => {
        // The caller went away (below): nothing to answer.
        if (res.destroyed) return;
        log.error({ err: error }, "forwarding to the old service failed");
        fail(res, cors);
      });
      // The caller went away before the answer was complete: stop the old service's request too.
      res.on("close", () => {
        if (!res.writableFinished) upstream.destroy();
      });
      // pipe, not pipeline: a failed request must not destroy the caller's socket before the 500.
      req.on("error", (error) => upstream.destroy(error));
      req.pipe(upstream);
    },
    close() {
      agent.destroy();
    },
  };
}
