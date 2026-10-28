import type { FastifyRequest } from "fastify";
import type { AppConfig } from "./config.js";
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

/**
 * The start-up warning of a provider whose stores are not all persistent yet: the SQL providers
 * keep users and files in memory until self-hosted Steps 3 (files) and 4 (local users). null for
 * the other providers.
 */
export function storageWarning(config: AppConfig): string | null {
  if (config.storageProvider !== "sqlite" && config.storageProvider !== "postgres") return null;
  return `STORAGE_PROVIDER=${config.storageProvider} keeps users and uploaded files in memory: they are lost on restart (self-hosted track Steps 3 and 4)`;
}

/**
 * The one `starting` line: which providers and settings this process runs with. Fixed keys, each a
 * setting's name or mode, never a connection string, URL with credentials, secret or token.
 */
export function startupSummary(config: AppConfig): Record<string, string | boolean> {
  return {
    edition: config.edition,
    shell: config.shell,
    storageProvider: config.storageProvider,
    userDirectory: config.userDirectory,
    identityProvider: config.identityProvider,
    accountNotices: config.accountNotices,
    readOnly: config.readOnly,
    webApp: config.webRoot !== null,
    publicBaseUrl: config.publicBaseUrl,
    nodeEnv: config.nodeEnv,
  };
}
