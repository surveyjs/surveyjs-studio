import { isIP } from "node:net";

/** The bridge's settings, read from `BRIDGE_*` environment variables (`loadSettings`). */
export interface BridgeSettings {
  /** `BRIDGE_STUDIO_URL` (required): Studio's API base URL, e.g. `http://studio:3000/api/v1`. */
  readonly studioUrl: string;
  /** `BRIDGE_LEGACY_URL` (required): the old service's base URL, for the forwarded paths. */
  readonly legacyUrl: string;
  /** `BRIDGE_CACHE_ENTRIES` (default 10000): how many surveys the `getSurvey` cache keeps. */
  readonly cacheEntries: number;
  /** `BRIDGE_PORT` (default 3002). */
  readonly port: number;
  /** `BRIDGE_HOST` (default 127.0.0.1; the image sets 0.0.0.0). */
  readonly host: string;
  /** `BRIDGE_STUDIO_TIMEOUT_MS` (default 10000): a Studio call taking longer answers an empty 500. */
  readonly studioTimeoutMs: number;
  /**
   * `BRIDGE_FILE_TIMEOUT_MS` (default 120000): how long a file's bytes (`image`, `file`,
   * `files?name=`) may take to stream through once Studio has answered; a file still streaming
   * then is cut off. Studio's headers must still come within `BRIDGE_STUDIO_TIMEOUT_MS`.
   */
  readonly fileTimeoutMs: number;
  /**
   * `BRIDGE_MAX_UPLOAD_BYTES` (default 11534336: Studio's default file limit of 10 MiB and 1 MiB
   * for the form around it): the largest `upload` body; a larger one is an empty `413`.
   */
  readonly maxUploadBytes: number;
  /**
   * `BRIDGE_UPLOAD_READ_TIMEOUT_MS` (default 60000): how long an `upload`'s body may take to arrive
   * in full; an upload still being read then is answered an empty `408` and its connection is
   * closed, so a caller trickling its body cannot hold one of the bridge's upload slots.
   */
  readonly uploadReadTimeoutMs: number;
  /**
   * `BRIDGE_TRUST_PROXY` (default none): addresses or CIDR ranges of proxies in front of the bridge
   * whose `X-Forwarded-For` names the caller. Empty: the caller is the socket's peer.
   */
  readonly trustProxy: readonly string[];
  /**
   * `BRIDGE_METRICS_PORT` (default none): the port of a second listener answering only
   * `GET /metrics`; must differ from `BRIDGE_PORT`. Unset: no such listener.
   */
  readonly metricsPort: number | null;
  /** `BRIDGE_METRICS_HOST` (default 127.0.0.1; the image sets 0.0.0.0): that listener's address. */
  readonly metricsHost: string;
}

export class SettingsError extends Error {
  constructor(problems: string[]) {
    super(`The bridge's settings are not valid:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    this.name = "SettingsError";
  }
}

type Env = Record<string, string | undefined>;

function isTrustedPeer(item: string): boolean {
  const slash = item.indexOf("/");
  if (slash < 0) return isIP(item) !== 0;
  const version = isIP(item.slice(0, slash));
  const prefix = item.slice(slash + 1);
  return (
    version !== 0 && /^[0-9]{1,3}$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128)
  );
}

/** Reads and checks the settings; every problem is listed in one `SettingsError`. */
export function loadSettings(env: Env): BridgeSettings {
  const problems: string[] = [];

  function baseUrl(name: string): string {
    const value = env[name];
    if (value === undefined || value === "") {
      problems.push(`${name} is required`);
      return "";
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      problems.push(`${name} must be an http or https URL`);
      return "";
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      problems.push(`${name} must be an http or https URL`);
    } else if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
      problems.push(`${name} must have no query, fragment or credentials`);
    }
    return value;
  }

  function integer(name: string, fallback: number, min: number, max: number): number {
    const value = env[name];
    if (value === undefined || value === "") return fallback;
    const parsed = /^[0-9]+$/.test(value) ? Number(value) : Number.NaN;
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
      problems.push(`${name} must be a whole number from ${min} to ${max}`);
      return fallback;
    }
    return parsed;
  }

  const studioUrl = baseUrl("BRIDGE_STUDIO_URL");
  const legacyUrl = baseUrl("BRIDGE_LEGACY_URL");
  const cacheEntries = integer("BRIDGE_CACHE_ENTRIES", 10_000, 0, 10_000_000);
  const port = integer("BRIDGE_PORT", 3002, 1, 65_535);
  const studioTimeoutMs = integer("BRIDGE_STUDIO_TIMEOUT_MS", 10_000, 1, 600_000);
  const fileTimeoutMs = integer("BRIDGE_FILE_TIMEOUT_MS", 120_000, 1, 3_600_000);
  const maxUploadBytes = integer("BRIDGE_MAX_UPLOAD_BYTES", 11_534_336, 1, 30_000_000);

  const uploadReadTimeoutMs = integer("BRIDGE_UPLOAD_READ_TIMEOUT_MS", 60_000, 1, 3_600_000);

  const host = env.BRIDGE_HOST ?? "127.0.0.1";
  if (host === "") problems.push("BRIDGE_HOST must not be empty");

  const metricsPort =
    env.BRIDGE_METRICS_PORT === undefined || env.BRIDGE_METRICS_PORT === ""
      ? null
      : integer("BRIDGE_METRICS_PORT", 0, 1, 65_535);
  if (metricsPort === port) problems.push("BRIDGE_METRICS_PORT must differ from BRIDGE_PORT");
  const metricsHost = env.BRIDGE_METRICS_HOST ?? "127.0.0.1";
  if (metricsHost === "") problems.push("BRIDGE_METRICS_HOST must not be empty");

  const trustProxy = (env.BRIDGE_TRUST_PROXY ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  if (!trustProxy.every(isTrustedPeer)) {
    problems.push(
      "BRIDGE_TRUST_PROXY must be a comma-separated list of IP addresses or CIDR ranges",
    );
  }

  if (problems.length > 0) throw new SettingsError(problems);
  return {
    studioUrl,
    legacyUrl,
    cacheEntries,
    port,
    host,
    studioTimeoutMs,
    fileTimeoutMs,
    maxUploadBytes,
    uploadReadTimeoutMs,
    trustProxy,
    metricsPort,
    metricsHost,
  };
}
