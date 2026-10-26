// `pnpm dev:prod-data`: the server and the Vite dev server against the stores and the sign-in named
// in server/.env (gitignored; template server/.env.example). Variables already set in the shell win.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { readPeerCertificate } from "./issuer-certificate.js";
import { describeTargets, envProblems, isLocalHttpsIssuer } from "./target.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const envFile = resolve(root, "server/.env");
const caFile = resolve(root, "server/.local/issuer-ca.pem");

if (!existsSync(envFile)) {
  console.error("server/.env not found: copy server/.env.example to server/.env and fill it in.");
  process.exit(2);
}
const env = { ...parseEnv(readFileSync(envFile, "utf8")), ...process.env };
const problems = envProblems(env);
if (problems.length > 0) {
  console.error("server/.env is not ready:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(2);
}

const childEnv: Record<string, string | undefined> = { ...process.env };
const issuer = env["OIDC_ISSUER_URL"] ?? "";
if (isLocalHttpsIssuer(issuer) && process.env["NODE_EXTRA_CA_CERTS"] === undefined) {
  // NODE_EXTRA_CA_CERTS is read when Node starts, so --env-file cannot set it: pass it down here.
  try {
    const pem = await readPeerCertificate(new URL(issuer));
    mkdirSync(dirname(caFile), { recursive: true });
    writeFileSync(caFile, pem);
    childEnv["NODE_EXTRA_CA_CERTS"] = caFile;
  } catch (error) {
    console.error(`Cannot reach the sign-in issuer ${issuer}: is the site's sign-in service running?`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

console.log("");
console.log("  REAL DATA: this run reads and writes the stores below.");
for (const line of describeTargets(env)) console.log(`  ${line}`);
console.log("");

const command =
  "pnpm --filter @surveyjs-studio/contract build:docs && concurrently -n server,web -c blue,green " +
  '"pnpm --filter @surveyjs-studio/server dev:prod-data" "pnpm --filter @surveyjs-studio/web dev"';
const child = spawn(command, { cwd: root, env: childEnv, shell: true, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
