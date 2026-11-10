// `pnpm sandbox:serve [--port 8080]`: serves web/dist-sandbox (`pnpm build:sandbox`) with the
// sandbox's nginx configuration in a container, as the demos server does. `--stop` removes it.
// `--port=8080` works too. It prints the address once the site answers, else one line on stderr.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const NAME = "studio-sandbox-local";
const IMAGE = "nginx:1.30-alpine";
const root = resolve(fileURLToPath(import.meta.url), "../../..");
const dist = resolve(root, "web/dist-sandbox");
const deploy = resolve(root, "deploy/sandbox");

const USAGE = "usage: sandbox:serve [--port 8080] | --stop";

/**
 * Reads the CLI arguments; throws an Error with the reason for an unknown or invalid one.
 * @param {string[]} args
 * @returns {{ stop: boolean, port: number }}
 */
export function parseServeArgs(args) {
  let stop = false;
  let port = 8080;
  for (let i = 0; i < args.length; i++) {
    const arg = /** @type {string} */ (args[i]);
    if (arg === "--stop") {
      stop = true;
      continue;
    }
    const equals = arg.indexOf("=");
    const flag = equals > 0 ? arg.slice(0, equals) : arg;
    if (flag !== "--port") throw new Error(`unknown argument ${arg}\n${USAGE}`);
    const value = equals > 0 ? arg.slice(equals + 1) : args[++i];
    port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`--port needs a port number\n${USAGE}`);
    }
  }
  return { stop, port };
}

/**
 * One line that says what failed: a command's own error (its stderr), not a stack trace.
 * @param {unknown} error
 */
export function errorLine(error) {
  const firstLine = (/** @type {string} */ text) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  if (error && typeof error === "object") {
    const { code, stderr } = /** @type {{ code?: unknown, stderr?: unknown }} */ (error);
    if (code === "ENOENT") return "docker was not found: install Docker and start it";
    if (typeof stderr === "string" && firstLine(stderr)) return firstLine(stderr);
    if (error instanceof Error) return firstLine(error.message);
  }
  return firstLine(String(error));
}

/** @typedef {"ok" | "refused" | string} ProbeResult "refused": nothing listens; another string: what went wrong */

/** @param {string} url @returns {Promise<ProbeResult>} */
async function fetchProbe(url) {
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2000) });
    await response.body?.cancel();
    return response.status === 200 ? "ok" : `HTTP ${response.status}`;
  } catch (error) {
    const code = /** @type {{ cause?: { code?: unknown } }} */ (error).cause?.code;
    if (code === "ECONNREFUSED" || code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT") {
      return "refused";
    }
    return errorLine(/** @type {{ cause?: unknown }} */ (error).cause ?? error);
  }
}

const PATHS = ["/", "/mockServiceWorker.js", "/version.json"];

/**
 * Waits until the site answers 200 for the shell, the worker and version.json, two rounds in a row.
 * Both loopback addresses are asked, as a browser may take either for `localhost`: 127.0.0.1 must
 * answer, and ::1 must answer too unless nothing listens there (no IPv6). A container's published
 * port takes connections before nginx inside does, and resets them, so one good answer is not enough.
 * @param {{ port: number, attempts?: number, probe?: (url: string) => Promise<ProbeResult>, sleep?: (ms: number) => Promise<void> }} options
 */
export async function waitUntilReady({
  port,
  attempts = 100,
  probe = fetchProbe,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  let good = 0;
  let lastFailure = "no answer";
  for (let attempt = 0; attempt < attempts; attempt++) {
    const urls = ["127.0.0.1", "[::1]"].flatMap((host) =>
      PATHS.map((path) => `http://${host}:${port}${path}`),
    );
    const results = await Promise.all(urls.map(probe));
    const failure = urls.findIndex((url, i) => {
      const result = results[i];
      return !(result === "ok" || (result === "refused" && url.includes("[::1]")));
    });
    if (failure < 0) {
      if (++good === 2) return;
    } else {
      good = 0;
      lastFailure = `${urls[failure]}: ${results[failure]}`;
    }
    await sleep(200);
  }
  throw new Error(`the site did not get ready; last: ${lastFailure}`);
}

/** @param {...string} a */
const docker = (...a) =>
  execFileSync("docker", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const removeContainer = () => {
  try {
    docker("rm", "-f", NAME);
  } catch {
    // none running
  }
};

/** The base path the build was made for (version.json; a build without it is for `/`). */
function builtBase() {
  try {
    const { base } = JSON.parse(readFileSync(resolve(dist, "version.json"), "utf8"));
    return typeof base === "string" ? base : "/";
  } catch {
    return "/";
  }
}

/** @param {string[]} args */
async function main(args) {
  const { stop, port } = parseServeArgs(args);
  if (stop) {
    removeContainer();
    console.log(`${NAME} removed`);
    return;
  }
  if (!existsSync(resolve(dist, "index.html"))) {
    throw new Error("web/dist-sandbox is missing: run `pnpm build:sandbox` first");
  }
  // deploy/sandbox/nginx.conf serves the site at the root.
  const base = builtBase();
  if (base !== "/") {
    throw new Error(
      `web/dist-sandbox was built for ${base}, and this serves the root: run \`pnpm build:sandbox\` without SANDBOX_BASE`,
    );
  }

  removeContainer();
  docker(
    "run",
    "--rm",
    "-d",
    "--name",
    NAME,
    "-p",
    `${port}:80`,
    "-v",
    `${dist}:/usr/share/nginx/html:ro`,
    "-v",
    `${deploy}:/etc/nginx/sandbox:ro`,
    "-v",
    `${resolve(deploy, "nginx.conf")}:/etc/nginx/conf.d/default.conf:ro`,
    IMAGE,
  );
  try {
    await waitUntilReady({ port });
  } catch (error) {
    try {
      console.error(`The container log:\n${docker("logs", NAME)}`);
    } catch {
      // no log to show
    }
    removeContainer();
    throw error;
  }
  console.log(`http://localhost:${port}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`sandbox:serve: ${errorLine(error)}`);
    process.exit(1);
  }
}
