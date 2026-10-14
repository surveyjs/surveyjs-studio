import type { FastifyRequest } from "fastify";

/** Query parameters never written to logs: the OAuth `code` and `state` of the sign-in callback. */
const REDACTED_PARAMETERS = new Set(["code", "state"]);

/** The request URL with the values of `code` and `state` replaced by `[redacted]`. */
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

/** Fastify's default `req` log serializer, with the URL redacted. */
export function serializeRequest(request: FastifyRequest) {
  const version = request.headers["accept-version"];
  return {
    method: request.method,
    url: redactUrl(request.url),
    version: typeof version === "string" ? version : undefined,
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket.remotePort,
  };
}
