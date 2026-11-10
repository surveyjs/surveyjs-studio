// The image checks (`pnpm image:checks`): the self-hosted image as a self-hosting admin uses it.
// The argument parsing, the names and the output parsing are pure (checks.test.ts); the checks
// themselves drive Docker (docker.ts) and the user flow (flow.mjs).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { docker, dockerSync, exec, freePort, lastLine, type Outcome } from "./docker.js";

export const CHECK_NAMES = [
  "non-root",
  "setup",
  "offline",
  "backup",
  "upgrade",
  "secrets",
  "compose",
  "notices",
] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

/** Every container, volume and network of a run is named `<prefix><run id>-<check>-<what>`. */
export const RESOURCE_PREFIX = "surveyjs-studio-check-";

export const USAGE = `Usage: pnpm image:checks --image <tag> [--previous <tag>] [--only <check>[,<check>]]

Checks a self-hosted image as an admin uses it. Needs Docker; leaves no container, volume or
network behind (logs of a failed check's containers go to docker-logs/).

  --image <tag>      The image under test (pnpm image:build:self-hosted builds
                     surveyjs-studio:self-hosted)
  --previous <tag>   The previous release, for the upgrade check (skipped without it)
  --only <checks>    Run only these, comma-separated: ${CHECK_NAMES.join(", ")}

Exit codes: 0 every check passed or was skipped, 1 a check failed, 2 usage error`;

export interface CheckOptions {
  readonly image: string;
  readonly previous: string | null;
  /** In the order of CHECK_NAMES. */
  readonly only: readonly CheckName[];
}

export type ParsedArgs =
  | { readonly ok: true; readonly options: CheckOptions }
  | { readonly ok: false; readonly exitCode: 0 | 2; readonly message: string };

const IMAGE_NAME = /^\w[\w.\-/:@]*$/;
const NAME_PART = /^[a-z0-9][a-z0-9-]*$/;

function isCheckName(name: string): name is CheckName {
  return (CHECK_NAMES as readonly string[]).includes(name);
}

/** The command line (`--` from pnpm is ignored). */
export function parseCheckArgs(argv: readonly string[]): ParsedArgs {
  const usageError = (message: string): ParsedArgs => ({
    ok: false,
    exitCode: 2,
    message: `${message}\n\n${USAGE}`,
  });
  const values = new Map<string, string>();
  const args = argv.filter((arg) => arg !== "--");
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--help" || arg === "-h") return { ok: false, exitCode: 0, message: USAGE };
    const [flag = "", inline] = arg.startsWith("--") ? arg.split(/=(.*)/s, 2) : [arg];
    if (!["--image", "--previous", "--only"].includes(flag)) {
      return usageError(`Unknown argument: ${arg}`);
    }
    const value = inline ?? args[++i];
    if (value === undefined) return usageError(`${flag} needs a value`);
    values.set(flag, value);
  }

  const image = values.get("--image");
  if (image === undefined) return usageError("--image is required");
  const previous = values.get("--previous") ?? null;
  for (const [flag, tag] of [
    ["--image", image],
    ["--previous", previous],
  ] as const) {
    if (tag !== null && !IMAGE_NAME.test(tag)) return usageError(`${flag}: not an image name`);
  }

  let only: CheckName[] = [...CHECK_NAMES];
  const list = values.get("--only");
  if (list !== undefined) {
    const names = list.split(",").map((name) => name.trim());
    if (names.every((name) => name === "")) return usageError("--only needs a check name");
    for (const name of names) {
      if (!isCheckName(name)) {
        return usageError(`Unknown check "${name}". The checks: ${CHECK_NAMES.join(", ")}`);
      }
    }
    only = CHECK_NAMES.filter((name) => names.includes(name));
  }
  return { ok: true, options: { image, previous, only } };
}

/** The backup folder's name from `surveyjs-studio backup`'s output; null when it has none. */
export function backupFolderName(output: string): string | null {
  const path = /^Backed up to (.+)$/m.exec(output)?.[1]?.trim();
  const name = path?.split("/").at(-1) ?? "";
  return /^[\w.-]+$/.test(name) && name !== "." && name !== ".." ? name : null;
}

/** `surveyjs-studio-check-<run id>-<what>`. Throws for a part Docker would not take. */
export function resourceName(runId: string, what: string): string {
  if (!NAME_PART.test(runId) || !NAME_PART.test(what)) {
    throw new Error(`not a resource name part: "${runId}", "${what}"`);
  }
  return `${RESOURCE_PREFIX}${runId}-${what}`;
}

/** A log line for a failure's reason: the setup link's token is a secret. */
export function redactLogLine(line: string): string {
  return line.replace(/(setup=)[^\s"&\\]+/g, "$1<redacted>");
}

// ------------------------------------------------------------------------------------- the run

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const flowPath = resolve(root, "scripts/image-checks/flow.mjs");
const logsDir = resolve(root, "docker-logs");

/** The port the self-hosted image listens on. */
const APP_PORT = 8080;
const READY_TIMEOUT_MS = 60_000;
const SETUP_LINK_TIMEOUT_MS = 30_000;
const SETUP_LINK = "/set-password?setup=";

/**
 * The first admin and the password the flow changes to. Synthetic local-only test values (as in
 * e2e/tests/support/password.ts), passed by name only and never printed.
 */
const FLOW_ENV: Readonly<Record<string, string>> = {
  ADMIN_EMAIL: "image-check-admin@example.com",
  ADMIN_PASSWORD: "image checks first admin password",
  FLOW_NEW_PASSWORD: "image checks changed admin password",
};
const ADMIN_SETTINGS = ["ADMIN_EMAIL", "ADMIN_PASSWORD"];

/** A failed check; the message is its reason. */
export class CheckFailure extends Error {}

function fail(reason: string): never {
  throw new CheckFailure(reason);
}

function failed(step: string, outcome: Outcome): never {
  fail(`${step} failed: ${lastLine(outcome.stderr || outcome.stdout)}`);
}

/** The log line a reason quotes: the `msg` of a JSON line, redacted and cut short. */
function describeLogLine(line: string): string {
  let text = line;
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed !== null && typeof parsed === "object" && "msg" in parsed) {
      text = String(parsed.msg);
    }
  } catch {
    // Not JSON: quote the line itself.
  }
  const redacted = redactLogLine(text);
  return redacted.length > 300 ? `${redacted.slice(0, 300)}…` : redacted;
}

export interface Server {
  readonly name: string;
  /** The published port on 127.0.0.1; null on an internal network. */
  readonly port: number | null;
  readonly startedAt: number;
}

interface ServerOptions {
  readonly name: string;
  readonly image: string;
  readonly volumes: readonly (readonly [volume: string, path: string])[];
  /** A network to join instead of publishing a port. */
  readonly network?: string;
  /** Settings passed by name; their values come from FLOW_ENV. */
  readonly settings?: readonly string[];
}

/** One run's resources: all named `surveyjs-studio-check-<id>-…`, removed by `cleanup`. */
export class Run {
  /** Logs of the containers removed during a check, kept for docker-logs/ if it fails. */
  private readonly removedLogs = new Map<string, string>();
  private clients = 0;
  private flowSource: string | null = null;

  constructor(readonly id: string) {}

  /** Everything of this run starts with this. */
  get prefix(): string {
    return `${RESOURCE_PREFIX}${this.id}-`;
  }

  name(check: CheckName, what: string): string {
    return resourceName(this.id, `${check}-${what}`);
  }

  async volume(name: string): Promise<string> {
    const outcome = await docker(["volume", "create", name]);
    if (outcome.code !== 0) failed("docker volume create", outcome);
    return name;
  }

  async network(name: string, internal: boolean): Promise<string> {
    const outcome = await docker(["network", "create", ...(internal ? ["--internal"] : []), name]);
    if (outcome.code !== 0) failed("docker network create", outcome);
    return name;
  }

  async startServer(options: ServerOptions): Promise<Server> {
    const port = options.network === undefined ? await freePort() : null;
    const args = ["run", "-d", "--name", options.name];
    if (port !== null) args.push("-p", `127.0.0.1:${port}:${APP_PORT}`);
    if (options.network !== undefined) args.push("--network", options.network);
    for (const [volume, path] of options.volumes) args.push("-v", `${volume}:${path}`);
    for (const setting of options.settings ?? []) args.push("-e", setting);
    args.push(options.image);
    const startedAt = Date.now();
    const outcome = await docker(args, { env: FLOW_ENV, timeoutMs: 600_000 });
    if (outcome.code !== 0) failed(`docker run ${options.image}`, outcome);
    return { name: options.name, port, startedAt };
  }

  /** Throws when the container no longer runs, with its exit code and last log line. */
  async assertRunning(server: Server, waitingFor: string): Promise<void> {
    const state = await docker([
      "inspect",
      "-f",
      "{{.State.Running}} {{.State.ExitCode}}",
      server.name,
    ]);
    const [running, exitCode] = state.stdout.trim().split(" ");
    if (state.code === 0 && running === "true") return;
    const logs = await docker(["logs", "--tail", "20", server.name]);
    const line = describeLogLine(lastLine(`${logs.stdout}\n${logs.stderr}`));
    fail(`the container stopped (exit code ${exitCode ?? "?"}) before ${waitingFor}: ${line}`);
  }

  /** Waits until `/readyz` on the published port answers 200. */
  async waitReady(server: Server): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let last = "no answer";
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/readyz`, {
          signal: AbortSignal.timeout(5000),
        });
        if (response.status === 200) return;
        last = `${response.status}`;
      } catch {
        await this.assertRunning(server, "/readyz answered 200");
      }
      await delay(500);
    }
    await this.assertRunning(server, "/readyz answered 200");
    fail(`/readyz did not answer 200 within ${READY_TIMEOUT_MS / 1000} s (last: ${last})`);
  }

  /** Whether the container's log holds `text` before `deadline`; looks at least once. */
  async logHas(server: Server, text: string, deadline: number): Promise<boolean> {
    for (;;) {
      const logs = await docker(["logs", server.name]);
      if (`${logs.stdout}\n${logs.stderr}`.includes(text)) return true;
      if (Date.now() >= deadline) return false;
      await delay(500);
    }
  }

  /** `docker exec <container> surveyjs-studio <args>`. */
  async studio(server: Server, args: readonly string[]): Promise<Outcome> {
    return docker(["exec", server.name, "surveyjs-studio", ...args], { timeoutMs: 300_000 });
  }

  /** Stops and removes a container; its log is kept in case the check fails. */
  async remove(name: string): Promise<void> {
    const logs = await docker(["logs", name]);
    if (logs.code === 0) this.removedLogs.set(name, `${logs.stdout}${logs.stderr}`);
    const outcome = await docker(["rm", "-f", "-v", name]);
    if (outcome.code !== 0) failed(`docker rm ${name}`, outcome);
  }

  async removeVolume(name: string): Promise<void> {
    const outcome = await docker(["volume", "rm", name]);
    if (outcome.code !== 0) failed(`docker volume rm ${name}`, outcome);
  }

  /** flow.mjs on this machine, against a published port. Returns its JSON. */
  async flowOnHost(server: Server, args: readonly string[]): Promise<Record<string, unknown>> {
    const outcome = await exec(
      process.execPath,
      [flowPath, `http://127.0.0.1:${server.port}`, ...args],
      { env: FLOW_ENV, timeoutMs: 180_000 },
    );
    return flowResult(args, outcome);
  }

  /** flow.mjs in a client container of `image` on `network`, piped to `node -`. */
  async flowInContainer(
    check: CheckName,
    image: string,
    network: string,
    server: Server,
    args: readonly string[],
  ): Promise<Record<string, unknown>> {
    this.flowSource ??= readFileSync(flowPath, "utf8");
    const name = this.name(check, `client-${++this.clients}`);
    const outcome = await docker(
      [
        "run",
        "-i",
        "--rm",
        "--name",
        name,
        "--network",
        network,
        ...Object.keys(FLOW_ENV).flatMap((setting) => ["-e", setting]),
        "--entrypoint",
        "node",
        image,
        "--input-type=module",
        "-",
        `http://${server.name}:${APP_PORT}`,
        ...args,
      ],
      { env: FLOW_ENV, input: this.flowSource, timeoutMs: 180_000 },
    );
    return flowResult(args, outcome);
  }

  /** Writes the logs of a check's containers to docker-logs/<name>.log. */
  saveLogs(check: CheckName): string[] {
    const prefix = `${this.prefix}${check}-`;
    const logs = new Map([...this.removedLogs].filter(([name]) => name.startsWith(prefix)));
    const live = dockerSync(["ps", "-a", "--filter", `name=${prefix}`, "--format", "{{.Names}}"]);
    for (const name of live.stdout.split(/\s+/).filter((n) => n.startsWith(prefix))) {
      const outcome = dockerSync(["logs", name]);
      if (outcome.code === 0) logs.set(name, `${outcome.stdout}${outcome.stderr}`);
    }
    if (logs.size === 0) return [];
    mkdirSync(logsDir, { recursive: true });
    for (const [name, text] of logs) writeFileSync(resolve(logsDir, `${name}.log`), text);
    return [...logs.keys()].map((name) => `docker-logs/${name}.log`);
  }

  /**
   * Removes every container (with its anonymous volumes), network and volume whose name starts
   * with `prefix` (default: the whole run). Blocking, so that it also runs after Ctrl+C. Returns
   * what is still there.
   */
  cleanup(prefix = this.prefix): string[] {
    // The name filter matches anywhere in a name: keep only the names that start with the prefix.
    const list = (args: readonly string[], format: string) =>
      dockerSync([...args, "--filter", `name=${prefix}`, "--format", format])
        .stdout.split(/\s+/)
        .filter((name) => name.startsWith(prefix));
    const kinds = [
      { kind: "container", ls: ["ps", "-a"], format: "{{.Names}}", rm: ["rm", "-f", "-v"] },
      { kind: "network", ls: ["network", "ls"], format: "{{.Name}}", rm: ["network", "rm"] },
      { kind: "volume", ls: ["volume", "ls"], format: "{{.Name}}", rm: ["volume", "rm", "-f"] },
    ];
    for (const { ls, format, rm } of kinds) {
      const names = list(ls, format);
      if (names.length > 0) dockerSync([...rm, ...names]);
    }
    return kinds.flatMap(({ kind, ls, format }) =>
      list(ls, format).map((name) => `${kind} ${name}`),
    );
  }
}

function flowResult(args: readonly string[], outcome: Outcome): Record<string, unknown> {
  if (outcome.code !== 0) {
    fail(`flow.mjs ${args[0] ?? ""}: ${lastLine(outcome.stderr).replace(/^flow: /, "")}`);
  }
  try {
    const parsed: unknown = JSON.parse(lastLine(outcome.stdout));
    if (parsed !== null && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // Reported below.
  }
  fail(`flow.mjs ${args[0] ?? ""} printed no JSON`);
}

function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

// ---------------------------------------------------------------------------------- the checks

export type CheckResult =
  { readonly status: "pass" } | { readonly status: "skip"; readonly reason: string };

type Check = (run: Run, options: CheckOptions) => Promise<CheckResult>;

const PASS: CheckResult = { status: "pass" };

/** The image runs as `node`, uid 1000. */
const nonRoot: Check = async (run, { image }) => {
  const inspect = await docker(["image", "inspect", "-f", "{{.Config.User}}", image]);
  if (inspect.code !== 0) failed("docker image inspect", inspect);
  const user = inspect.stdout.trim();
  if (user !== "node") fail(`Config.User is "${user}", not "node"`);
  const id = await docker([
    "run",
    "--rm",
    "--name",
    run.name("non-root", "id"),
    "--entrypoint",
    "id",
    image,
    "-u",
  ]);
  if (id.code !== 0) failed("id -u", id);
  if (id.stdout.trim() !== "1000") fail(`id -u printed "${id.stdout.trim()}", not 1000`);
  return PASS;
};

/** An empty volume and no settings: the server gets ready and logs the one-time setup link. */
const setup: Check = async (run, { image }) => {
  const data = await run.volume(run.name("setup", "data"));
  const server = await run.startServer({
    name: run.name("setup", "server"),
    image,
    volumes: [[data, "/data"]],
  });
  await run.waitReady(server);
  if (!(await run.logHas(server, SETUP_LINK, server.startedAt + SETUP_LINK_TIMEOUT_MS))) {
    fail(`the log has no ${SETUP_LINK} link within ${SETUP_LINK_TIMEOUT_MS / 1000} s`);
  }
  return PASS;
};

/** No route out (an internal network): the whole flow works from a client on that network. */
const offline: Check = async (run, { image }) => {
  const network = await run.network(run.name("offline", "net"), true);
  const internal = await docker(["network", "inspect", "-f", "{{.Internal}}", network]);
  if (internal.stdout.trim() !== "true") fail("the check's network is not internal");
  const data = await run.volume(run.name("offline", "data"));
  const server = await run.startServer({
    name: run.name("offline", "server"),
    image,
    volumes: [[data, "/data"]],
    network,
    settings: ADMIN_SETTINGS,
  });
  // No published port here: a client on the network waits, a few seconds at a time, so that a
  // server that stopped fails the check at once.
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    await run.assertRunning(server, "/healthz and /readyz answered 200");
    try {
      await run.flowInContainer("offline", image, network, server, ["wait-ready", "5"]);
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
    }
  }
  const created = await run.flowInContainer("offline", image, network, server, [
    "bootstrap-and-create",
  ]);
  if (typeof created["surveyId"] !== "string") fail("bootstrap-and-create returned no surveyId");
  return PASS;
};

/** Backup to a second volume, lose the data volume, restore into a new one: the data is back. */
const backup: Check = async (run, { image }) => {
  const backups = await run.volume(run.name("backup", "backups"));
  const data = await run.volume(run.name("backup", "data"));
  const first = await run.startServer({
    name: run.name("backup", "server"),
    image,
    volumes: [
      [data, "/data"],
      [backups, "/backups"],
    ],
    settings: ADMIN_SETTINGS,
  });
  await run.waitReady(first);
  const created = await run.flowOnHost(first, ["bootstrap-and-create"]);
  const surveyId = String(created["surveyId"]);

  const backedUp = await run.studio(first, ["backup", "--to", "/backups"]);
  if (backedUp.code !== 0) failed("surveyjs-studio backup", backedUp);
  const folder = backupFolderName(backedUp.stdout);
  if (folder === null) fail("surveyjs-studio backup printed no 'Backed up to' line");
  await run.remove(first.name);
  await run.removeVolume(data);

  const restoredData = await run.volume(run.name("backup", "restored"));
  const restore = await docker(
    [
      "run",
      "--rm",
      "--name",
      run.name("backup", "restore"),
      "-v",
      `${restoredData}:/data`,
      "-v",
      `${backups}:/backups`,
      image,
      "surveyjs-studio",
      "restore",
      `/backups/${folder}`,
    ],
    { timeoutMs: 300_000 },
  );
  if (restore.code !== 0) failed("surveyjs-studio restore", restore);

  const second = await run.startServer({
    name: run.name("backup", "restored-server"),
    image,
    volumes: [[restoredData, "/data"]],
  });
  await run.waitReady(second);
  await run.flowOnHost(second, ["verify", surveyId]);
  return PASS;
};

/** The previous release's data, opened by the image under test: migrated, nothing lost. */
const upgrade: Check = async (run, { image, previous }) => {
  if (previous === null) return { status: "skip", reason: "no previous release" };
  const present = await docker(["image", "inspect", "-f", "{{.Id}}", previous]);
  if (present.code !== 0) {
    const pulled = await docker(["pull", previous], { timeoutMs: 600_000 });
    if (pulled.code !== 0) failed(`docker pull ${previous}`, pulled);
  }
  const data = await run.volume(run.name("upgrade", "data"));
  const old = await run.startServer({
    name: run.name("upgrade", "previous"),
    image: previous,
    volumes: [[data, "/data"]],
    settings: ADMIN_SETTINGS,
  });
  await run.waitReady(old);
  const created = await run.flowOnHost(old, ["bootstrap-and-create"]);
  const surveyId = String(created["surveyId"]);
  const wide = await run.flowOnHost(old, ["create-wide"]);
  const stopped = await docker(["stop", old.name], { timeoutMs: 60_000 });
  if (stopped.code !== 0) failed("docker stop", stopped);
  await run.remove(old.name);

  const current = await run.startServer({
    name: run.name("upgrade", "current"),
    image,
    volumes: [[data, "/data"]],
  });
  await run.waitReady(current);
  await run.flowOnHost(current, ["verify", surveyId]);
  await run.flowOnHost(current, ["verify-wide", JSON.stringify(wide)]);
  const status = await run.studio(current, ["status"]);
  if (status.code !== 0) failed("surveyjs-studio status", status);
  if (!/^Pending: none$/m.test(status.stdout)) {
    fail(`surveyjs-studio status lists pending migrations: ${lastLine(status.stdout)}`);
  }
  return PASS;
};

/** No settings file in the image (the publish job's check of the hosted image too). */
const secrets: Check = async (run, { image }) => {
  const found = await docker([
    "run",
    "--rm",
    "--name",
    run.name("secrets", "find"),
    "--entrypoint",
    "sh",
    image,
    "-c",
    "find /app -name '*.env*'",
  ]);
  if (found.code !== 0) failed("find /app", found);
  const files = found.stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (files.length > 0) fail(`settings files in the image: ${files.join(", ")}`);
  return PASS;
};

const COMPOSE_DIR = resolve(root, "deploy/compose");
const COMPOSE_FILES = ["compose.sqlite.yml", "compose.postgres.yml"] as const;

/**
 * Each Compose example, started as an admin would start it (an `.env` next to the file, here in a
 * temp folder with local test values), then the user flow against the published port.
 */
const compose: Check = async (run, { image }) => {
  const folder = mkdtempSync(resolve(tmpdir(), "surveyjs-studio-compose-"));
  try {
    for (const file of COMPOSE_FILES) {
      const kind = file.split(".")[1] ?? "x";
      const project = run.name("compose", kind);
      const port = await freePort();
      const settings: Record<string, string> = {
        SURVEYJS_STUDIO_IMAGE: image,
        SURVEYJS_STUDIO_PORT: String(port),
        PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
        ADMIN_EMAIL: FLOW_ENV["ADMIN_EMAIL"] ?? "",
        ADMIN_PASSWORD: FLOW_ENV["ADMIN_PASSWORD"] ?? "",
        POSTGRES_PASSWORD: "compose-check-postgres",
        S3_ACCESS_KEY_ID: "composecheckaccess",
        S3_SECRET_ACCESS_KEY: "composechecksecretkey",
      };
      const envFile = resolve(folder, `${kind}.env`);
      writeFileSync(
        envFile,
        Object.entries(settings)
          .map(([name, value]) => `${name}=${value}`)
          .join("\n") + "\n",
      );
      const base = [
        "compose",
        "-p",
        project,
        "-f",
        resolve(COMPOSE_DIR, file),
        "--env-file",
        envFile,
      ];
      const up = await docker([...base, "up", "-d", "--wait", "--wait-timeout", "180"], {
        timeoutMs: 600_000,
      });
      if (up.code !== 0) failed(`${file}: docker compose up`, up);
      const server: Server = { name: `${project}-app-1`, port, startedAt: Date.now() };
      await run.waitReady(server);
      try {
        await run.flowOnHost(server, ["bootstrap-and-create"]);
      } catch (error) {
        throw new CheckFailure(
          `${file}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const down = await docker([...base, "down", "-v", "--remove-orphans"], {
        timeoutMs: 180_000,
      });
      if (down.code !== 0) failed(`${file}: docker compose down`, down);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  return PASS;
};

/** What a real notice always lists: the SurveyJS form library and React. */
const NOTICE_MARKERS = ["survey-core@", "react@"] as const;

export function missingFromNotices(text: string): string[] {
  return NOTICE_MARKERS.filter((marker) => !text.includes(marker));
}

/** The third-party notice the build writes is in the image (THIRD_PARTY_NOTICES.md). */
const notices: Check = async (run, { image }) => {
  const read = await docker([
    "run",
    "--rm",
    "--name",
    run.name("notices", "cat"),
    "--entrypoint",
    "cat",
    image,
    "/app/THIRD_PARTY_NOTICES.md",
  ]);
  if (read.code !== 0) failed("cat /app/THIRD_PARTY_NOTICES.md", read);
  const missing = missingFromNotices(read.stdout);
  if (missing.length > 0) fail(`THIRD_PARTY_NOTICES.md does not list: ${missing.join(", ")}`);
  return PASS;
};

export const CHECKS: Readonly<Record<CheckName, Check>> = {
  "non-root": nonRoot,
  setup,
  offline,
  backup,
  upgrade,
  secrets,
  compose,
  notices,
};
