import type { FastifyRequest } from "fastify";
import { truncatedIp } from "./ip.js";

/**
 * Query parameters never written to logs: the OAuth `code` and `state` of the sign-in callback and
 * the respondent's `clientId`.
 */
const REDACTED_PARAMETERS = new Set(["code", "state", "clientId"]);

/** The request URL with the values of `code`, `state` and `clientId` replaced by `[redacted]`. */
export function redactUrl(url: string): string {
  const at = url.indexOf("?");
  if (at < 0) return url;
  const pairs = url
    .slice(at + 1)
    .split("&")
    .map((pair) => {
      const equals = pair.indexOf("=");
      const key = equals < 0 ? pair : pair.slice(0, equals);
      let name = key;
      try {
        name = decodeURIComponent(key.replaceAll("+", " "));
      } catch {
        // A malformed key is compared as it is.
      }
      return REDACTED_PARAMETERS.has(name) ? `${key}=[redacted]` : pair;
    });
  return `${url.slice(0, at)}?${pairs.join("&")}`;
}

/**
 * Log fields replaced by `[redacted]`: at trace level @fastify/multipart logs an upload's request
 * headers, which carry the session cookie and the respondent's full X-Forwarded-For address (R21).
 */
export const REDACTED_LOG_PATHS: readonly string[] = ["busboyOptions.headers"];

/** Fastify's default `req` log serializer, with the URL redacted and the address truncated. */
export function serializeRequest(request: FastifyRequest) {
  const version = request.headers["accept-version"];
  return {
    method: request.method,
    url: redactUrl(request.url),
    version: typeof version === "string" ? version : undefined,
    host: request.host,
    remoteAddress: truncatedIp(request.ip),
    remotePort: request.socket.remotePort,
  };
}
