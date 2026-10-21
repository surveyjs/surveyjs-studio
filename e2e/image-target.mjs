// The image target (E2E_TARGET=image): each server and preview pair becomes one container of the
// production image, which serves the web app itself. It runs with `docker run --network host`,
// which works on Linux only, so it is meant for CI. Shared by the config, the runner script and
// the global teardown.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Every container the image target may start (memory mode: 5173 and 5174; Azurite mode: 5173). */
export const imageContainers = [
  "my-surveys-e2e-memory-5173",
  "my-surveys-e2e-memory-5174",
  "my-surveys-e2e-azurite-5173",
];

// `docker logs` of each container goes here before it is removed; CI uploads the folder on failure.
const logsDir = fileURLToPath(new URL("../docker-logs/", import.meta.url));

/**
 * True when `E2E_TARGET=image`. Throws for another value, and on Windows and macOS, where Docker
 * runs in a VM and `--network host` does not reach the host's ports.
 */
export function isImageTarget(env) {
  const target = env["E2E_TARGET"]?.trim() || "source";
  if (target !== "source" && target !== "image") {
    throw new Error(`E2E_TARGET must be image or unset, got "${target}"`);
  }
  if (target === "image" && process.platform !== "linux") {
    throw new Error(
      `E2E_TARGET=image is Linux only (CI): it runs the image with docker run --network host, which does not reach the host's ports on ${process.platform}. Run the suites without E2E_TARGET.`,
    );
  }
  return target === "image";
}

/** The image under test: `E2E_IMAGE`, default `my-surveys:ci` (built by `docker build -t my-surveys:ci .`). */
export function imageTag(env) {
  const tag = env["E2E_IMAGE"]?.trim() || "my-surveys:ci";
  if (!/^[\w][\w.\-/:@]*$/.test(tag)) throw new Error(`E2E_IMAGE is not an image name: "${tag}"`);
  return tag;
}

/** Saves `docker logs` of each image container to docker-logs/<name>.log, then removes it. */
export function removeImageContainers() {
  for (const name of imageContainers) {
    const logs = spawnSync("docker", ["logs", name], { encoding: "utf8" });
    if (logs.status === 0) {
      mkdirSync(logsDir, { recursive: true });
      writeFileSync(`${logsDir}${name}.log`, `${logs.stdout}${logs.stderr}`);
    }
    spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  }
}
