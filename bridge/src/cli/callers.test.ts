import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** Runs `bridge-callers` as the image does (through tsx), `input` on stdin. */
function runCli(input: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "bridge/src/cli/callers.ts"], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

const line = (time: string, fields: Record<string, unknown>) =>
  JSON.stringify({ level: 30, time: Date.parse(time), msg: "request", ...fields });

describe("bridge-callers", () => {
  it("reads log lines on stdin and writes the CSV to stdout", async () => {
    const { code, stdout, stderr } = await runCli(
      [
        line("2026-11-22T10:00:00.000Z", { action: "getActive", key: "aaaa", status: "200" }),
        "not a log line",
        line("2026-11-22T11:00:00.000Z", { action: "getActive", key: "aaaa", status: "200" }),
        line("2026-11-22T12:00:00.000Z", { action: "getSurvey", status: "200" }),
      ].join("\r\n"),
    );
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toBe(
      "day,key,action,count,first,last\n" +
        "2026-11-22,,getSurvey,1,2026-11-22T12:00:00.000Z,2026-11-22T12:00:00.000Z\n" +
        "2026-11-22,aaaa,getActive,2,2026-11-22T10:00:00.000Z,2026-11-22T11:00:00.000Z\n",
    );
  }, 20_000);
});
