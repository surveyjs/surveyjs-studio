// `pnpm sandbox:wait --url <url> --commit <sha> [--timeout-min 30] [--interval-s 15]`: waits until
// <url>/version.json names the commit, that is, until the demos server has rebuilt the sandbox
// branch and serves it. Exit code 0 on a match, 1 on a timeout, 2 on bad arguments (the message
// is on stderr).
import { pathToFileURL } from "node:url";

/**
 * @typedef {object} WaitOptions
 * @property {string} url The site's address
 * @property {string} commit The commit /version.json must name
 * @property {number} [timeoutMs]
 * @property {number} [intervalMs]
 * @property {(url: string) => Promise<{ commit?: unknown } | undefined>} [fetchJson]
 * @property {() => number} [now]
 * @property {(ms: number) => Promise<void>} [sleep]
 */

/** @param {unknown} error */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/**
 * @param {WaitOptions} options
 * @returns {Promise<void>}
 */
export async function waitForVersion({
  url,
  commit,
  timeoutMs = 30 * 60_000,
  intervalMs = 15_000,
  fetchJson,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const versionUrl = `${url.replace(/\/+$/, "")}/version.json`;
  // A stalled server must not hold a poll past the deadline.
  const requestTimeout = Math.min(intervalMs, 30_000);
  /** @type {NonNullable<WaitOptions["fetchJson"]>} */
  const get =
    fetchJson ??
    (async (address) => {
      const response = await fetch(address, {
        cache: "no-store",
        signal: AbortSignal.timeout(requestTimeout),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${address}`);
      return /** @type {{ commit?: unknown }} */ (await response.json());
    });
  const deadline = now() + timeoutMs;
  /** @type {unknown} */
  let lastSeen;
  /** @type {string | undefined} */
  let lastError;
  for (;;) {
    try {
      const seen = (await get(versionUrl))?.commit;
      if (seen === commit) return;
      lastSeen = seen;
      lastError = undefined;
    } catch (error) {
      lastError = messageOf(error);
    }
    if (now() >= deadline) break;
    await sleep(intervalMs);
  }
  throw new Error(
    `${versionUrl} did not show commit ${commit} within ${Math.round(timeoutMs / 1000)} s; ` +
      `last commit seen: ${lastSeen === undefined ? "none" : String(lastSeen)}` +
      (lastError === undefined ? "" : `; last error: ${lastError}`),
  );
}

const USAGE = "usage: sandbox:wait --url <url> --commit <sha> [--timeout-min 30] [--interval-s 15]";

/**
 * Reads the CLI arguments; throws an Error with the reason for a missing, unknown or invalid one.
 * @param {string[]} args
 * @returns {{ url: string, commit: string, timeoutMs: number, intervalMs: number }}
 */
export function parseWaitArgs(args) {
  /** @type {Record<string, string>} */
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = /** @type {string} */ (args[i]);
    const value = args[i + 1];
    if (!["--url", "--commit", "--timeout-min", "--interval-s"].includes(flag)) {
      throw new Error(`unknown argument ${flag}\n${USAGE}`);
    }
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} needs a value\n${USAGE}`);
    }
    values[flag] = value;
  }
  const { "--url": url, "--commit": commit } = values;
  if (!url || !commit) throw new Error(`--url and --commit are required\n${USAGE}`);
  /** @param {string} flag @param {number} fallback */
  const positive = (flag, fallback) => {
    const raw = values[flag];
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} must be a positive number: ${raw}`);
    return n;
  };
  return {
    url,
    commit,
    timeoutMs: positive("--timeout-min", 30) * 60_000,
    intervalMs: positive("--interval-s", 15) * 1000,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  /** @type {ReturnType<typeof parseWaitArgs>} */
  let options;
  try {
    options = parseWaitArgs(process.argv.slice(2));
  } catch (error) {
    console.error(messageOf(error));
    process.exit(2);
  }
  try {
    await waitForVersion(options);
    console.log(`${options.url} serves commit ${options.commit}`);
  } catch (error) {
    console.error(messageOf(error));
    process.exit(1);
  }
}
