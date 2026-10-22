/**
 * What happens to the connection when a body is over its route's limit (ADR 0004).
 *
 * Fastify refuses such a body on its declared `Content-Length`, before reading it, and answers 413
 * with `Connection: close`. Node then closes the socket with the rest of the body unread, and the
 * kernel answers the client's next bytes with a reset. A client that is still sending the body
 * (a fetch, a browser, the survey library's XHR) then sees `EPIPE` / `ECONNRESET` instead of the
 * 413, depending on which arrives first: the client cannot tell a refusal from a network failure.
 *
 * So a small overflow is read to its end and dropped instead: without `Connection: close`, Node
 * discards the rest of the body (it never reaches memory) and keeps the connection, and the client
 * reads the 413 once it has sent everything. Only a body whose declared length is at most
 * `DRAINED_OVERFLOW_FACTOR` times the route's limit is read; a larger one, or one without a declared
 * length (chunked), keeps `Connection: close`. So the 413 path reads at most that many bytes. Other early
 * answers (401/403 from authentication, 415, 429, multipart refusals) have no `Connection: close`, so
 * Node drains their bodies too; those are bounded only by `REQUEST_TIMEOUT_SECONDS`.
 */
import type { FastifyReply, FastifyRequest } from "fastify";

/** A refused body is read to its end when it declares at most this many times the route's limit. */
export const DRAINED_OVERFLOW_FACTOR = 4;

/** Keeps the connection of a 413 for a body over the limit when the overflow is small. */
export function drainSmallOverflow(request: FastifyRequest, reply: FastifyReply): void {
  const declared = Number(request.headers["content-length"]);
  // `routeOptions.bodyLimit` equals the enforced limit only while no content-type parser sets its own.
  if (
    Number.isSafeInteger(declared) &&
    declared <= request.routeOptions.bodyLimit * DRAINED_OVERFLOW_FACTOR
  ) {
    reply.removeHeader("connection");
  }
}
