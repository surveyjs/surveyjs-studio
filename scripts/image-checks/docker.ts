// Spawn helpers of the image checks. Docker is always started with an argument array and no
// shell: Git Bash on Windows would rewrite `/data`-like arguments, and no value is ever put on a
// command line (settings go by name, `-e NAME`, with the value in the child's environment).
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

export interface Outcome {
  /** The exit code; -1 when the process could not start or was killed. */
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SpawnOptions {
  /** Added to this process's environment: the values of the `-e NAME` settings. */
  readonly env?: Readonly<Record<string, string>>;
  /** Written to the child's stdin. */
  readonly input?: string;
  /** Killed after this long (default 2 minutes). */
  readonly timeoutMs?: number;
}

/** Runs a command to its end and collects its output. Never throws. */
export function exec(
  command: string,
  args: readonly string[],
  options: SpawnOptions = {},
): Promise<Outcome> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const timer = setTimeout(() => {
      stderr += `\n${command} ${args[0] ?? ""} did not finish in ${(options.timeoutMs ?? 120_000) / 1000} s`;
      child.kill();
    }, options.timeoutMs ?? 120_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\ncannot start ${command}: ${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input ?? "");
  });
}

/** `docker <args>`. Never throws. */
export function docker(args: readonly string[], options: SpawnOptions = {}): Promise<Outcome> {
  return exec("docker", args, options);
}

/** `docker <args>`, blocking: for the cleanup after Ctrl+C, when no promise runs any more. */
export function dockerSync(args: readonly string[]): Outcome {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** The last line of a command's error output that says something, for a failure's reason. */
export function lastLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.at(-1) ?? "(no output)";
}

/** A TCP port that is free on 127.0.0.1 right now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}
