// `pnpm sandbox:serve [--port 8080]`: serves web/dist-sandbox (`pnpm build:sandbox`) with the
// sandbox's nginx configuration in a container, as the demos server does. `--stop` removes it.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "studio-sandbox-local";
const IMAGE = "nginx:1.30-alpine";
const root = resolve(fileURLToPath(import.meta.url), "../../..");
const dist = resolve(root, "web/dist-sandbox");
const deploy = resolve(root, "deploy/sandbox");

const args = process.argv.slice(2);
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

if (args.includes("--stop")) {
  removeContainer();
  console.log(`${NAME} removed`);
  process.exit(0);
}

const portIndex = args.indexOf("--port");
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 8080;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("--port needs a port number");
  process.exit(1);
}
if (!existsSync(resolve(dist, "index.html"))) {
  console.error("web/dist-sandbox is missing: run `pnpm build:sandbox` first");
  process.exit(1);
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

const url = `http://localhost:${port}`;
for (let attempt = 0; attempt < 50; attempt++) {
  try {
    if ((await fetch(`${url}/version.json`)).status === 200) {
      console.log(url);
      process.exit(0);
    }
  } catch {
    // not listening yet
  }
  await new Promise((r) => setTimeout(r, 200));
}
console.error(`${url}/version.json did not answer 200; the container log:`);
try {
  console.error(docker("logs", NAME));
} catch (error) {
  console.error(String(error));
}
removeContainer();
process.exit(1);
