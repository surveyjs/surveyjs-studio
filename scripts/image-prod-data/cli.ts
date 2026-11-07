// `pnpm image:prod-data`: the production image against the stores and the sign-in named in
// server/.env (gitignored; template server/.env.example), at http://localhost:3000. Only the file
// reaches the container: variables set in the shell do not override it here.
// `--env-file <path>` reads another file instead; it is for testing the launcher on the replica.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { readPeerCertificate } from "../dev-prod-data/issuer-certificate.js";
import { describeTargets, isLocalHttpsIssuer } from "../dev-prod-data/target.js";
import { APP_PORT, forwardScript, forwardedPorts, imageEnvProblems } from "./plan.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const composeFile = resolve(root, "docker/image-prod-data.yaml");
const caFile = resolve(root, "server/.local/issuer-ca.pem");

// Node reads --env-file anywhere on its command line: the package script ends with "--" so that
// it stays an argument of this script.
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { "env-file": { type: "string" } },
});
const envFile = resolve(root, values["env-file"] ?? "server/.env");
const shown = values["env-file"] ?? "server/.env";

if (!existsSync(envFile)) {
  console.error(
    values["env-file"] === undefined
      ? `${shown} not found: copy server/.env.example to server/.env and fill it in.`
      : `${shown} not found: check the --env-file path.`,
  );
  process.exit(2);
}
const text = readFileSync(envFile, "utf8");
const env = parseEnv(text);
const problems = imageEnvProblems(env, text);
if (problems.length > 0) {
  console.error(`${shown} is not ready for the image:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(2);
}

const ports = forwardedPorts(env);
const composeEnv: Record<string, string | undefined> = {
  ...process.env,
  APP_ENV_FILE: envFile,
  FORWARD_SCRIPT: forwardScript(ports),
  // A file is mounted either way; Node reads it only when CONTAINER_CA_FILE names it.
  ISSUER_CA_PEM: "# The issuer is not https on this machine: no certificate.\n",
  CONTAINER_CA_FILE: "",
};
const issuer = env["OIDC_ISSUER_URL"] ?? "";
if (isLocalHttpsIssuer(issuer)) {
  try {
    const pem = await readPeerCertificate(new URL(issuer));
    mkdirSync(dirname(caFile), { recursive: true });
    writeFileSync(caFile, pem);
    composeEnv["ISSUER_CA_PEM"] = pem;
    composeEnv["CONTAINER_CA_FILE"] = "/certs/issuer-ca.pem";
  } catch (error) {
    console.error(
      `Cannot reach the sign-in issuer ${issuer}: is the site's sign-in service running?`,
    );
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

console.log("");
console.log("  REAL DATA: this run reads and writes the stores below.");
for (const line of describeTargets({ ...env, PUBLIC_BASE_URL: `http://localhost:${APP_PORT}` })) {
  console.log(`  ${line}`);
}
console.log(`  Forwarded to the host: localhost:${ports.join(", localhost:")}`);
console.log("  Stop with Ctrl+C.");
console.log("");

const compose = ["compose", "-f", composeFile];
// Ctrl+C reaches docker compose too, which stops the containers; then they are removed below.
process.on("SIGINT", () => undefined);
const child = spawn("docker", [...compose, "up", "--build"], {
  cwd: root,
  env: composeEnv,
  stdio: "inherit",
});
child.on("error", (error) => {
  console.error(`Cannot start docker: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code) => {
  spawnSync("docker", [...compose, "down"], { cwd: root, env: composeEnv, stdio: "inherit" });
  process.exit(code ?? 1);
});
