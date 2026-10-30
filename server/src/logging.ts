import type { FastifyRequest } from "fastify";
import type { AppConfig } from "./config.js";
import { truncatedIp } from "./ip.js";

/**
 * Query parameters never written to logs: the OAuth `code` and `state` of the sign-in callback and
 * the respondent's `clientId`.
 */
const REDACTED_PARAMETERS = new Set(["code", "state", "clientId", "setup", "token"]);

/**
 * The request URL with the values of `code`, `state`, `clientId` and the set-password links'
 * `setup` and `token` replaced by `[redacted]`.
 */
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
 * What the log gets for an unhandled error. A PostgreSQL error (pg's DatabaseError: a `severity`
 * and a five-character SQLSTATE `code`) is reduced to its code and routine: its message, `detail`
 * and `where` can quote the values being stored, a respondent's answers among them. Any other
 * error is logged as it is.
 */
export function loggableError(error: unknown): unknown {
  const fields = error as { severity?: unknown; code?: unknown; routine?: unknown } | null;
  const isDatabaseError =
    typeof fields?.severity === "string" &&
    typeof fields.code === "string" &&
    /^[0-9A-Z]{5}$/.test(fields.code);
  if (!isDatabaseError) return error;
  const routine =
    typeof fields.routine === "string" && /^\w+$/.test(fields.routine) ? fields.routine : undefined;
  return { type: "DatabaseError", code: fields.code, ...(routine && { routine }) };
}

/**
 * The start-up warning of a provider whose stores are not all persistent yet: the SQL providers
 * keep the users in memory with USER_DIRECTORY=memory (use local). null otherwise.
 */
export function storageWarning(config: AppConfig): string | null {
  if (config.storageProvider !== "sqlite" && config.storageProvider !== "postgres") return null;
  if (config.userDirectory === "local") return null;
  return `STORAGE_PROVIDER=${config.storageProvider} keeps users in memory (USER_DIRECTORY=memory): they are lost on restart; use USER_DIRECTORY=local`;
}

/**
 * The start-up warning of a production server whose PUBLIC_BASE_URL names this machine: the
 * sign-in and set-password links point there. null otherwise.
 */
export function publicUrlWarning(config: AppConfig): string | null {
  if (config.nodeEnv !== "production") return null;
  const host = new URL(config.publicBaseUrl).hostname;
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]") return null;
  return `PUBLIC_BASE_URL is ${config.publicBaseUrl}: sign-in and set-password links point there; set it to the address people open`;
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
