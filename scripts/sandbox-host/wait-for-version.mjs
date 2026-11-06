// `pnpm sandbox:wait --url <url> --commit <sha> [--timeout-min 30] [--interval-s 15]`: waits until
// <url>/version.json names the commit, that is, until the demos server has rebuilt the sandbox
// branch and serves it. Exit code 0 on a match, 1 on a timeout (the message is on stderr).
import { pathToFileURL } from "node:url";

async function defaultFetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

export async function waitForVersion({
  url,
  commit,
  timeoutMs = 30 * 60_000,
  intervalMs = 15_000,
  fetchJson = defaultFetchJson,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const versionUrl = `${url.replace(/\/+$/, "")}/version.json`;
  const deadline = now() + timeoutMs;
  let lastSeen;
  let lastError;
  for (;;) {
    try {
      const seen = (await fetchJson(versionUrl))?.commit;
      if (seen === commit) return;
      lastSeen = seen;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    if (now() >= deadline) break;
    await sleep(intervalMs);
  }
  const last = lastError
    ? `the last error was: ${lastError.message}`
    : `the last commit seen was ${lastSeen}`;
  throw new Error(
    `${versionUrl} did not show commit ${commit} within ${Math.round(timeoutMs / 1000)} s; ${last}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    return at >= 0 ? args[at + 1] : fallback;
  };
  const url = option("url");
  const commit = option("commit");
  if (!url || !commit) {
    console.error(
      "usage: sandbox:wait --url <url> --commit <sha> [--timeout-min 30] [--interval-s 15]",
    );
    process.exit(2);
  }
  try {
    await waitForVersion({
      url,
      commit,
      timeoutMs: Number(option("timeout-min", 30)) * 60_000,
      intervalMs: Number(option("interval-s", 15)) * 1000,
    });
    console.log(`${url} serves commit ${commit}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
