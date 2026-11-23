import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = resolve(dirname(fileURLToPath(import.meta.url)), "../../deploy/hetzner/setup.sh");
const hasBash = spawnSync("bash", ["--version"]).status === 0;

function printCaddyfile(...args: string[]) {
  const run = spawnSync("bash", [script, "--print-caddyfile", "--domain", "example.org", ...args], {
    encoding: "utf8",
  });
  return { code: run.status, out: run.stdout, err: run.stderr };
}

// Skipped only when there is no bash on PATH (setup.sh is a bash script; on Windows use Git Bash).
describe.skipIf(!hasBash)("setup.sh --print-caddyfile", () => {
  it("has no global block without --trusted-proxies", () => {
    const { code, out } = printCaddyfile();
    expect(code).toBe(0);
    expect(out).not.toContain("trusted_proxies");
    expect(out).toContain("example.org {");
  });

  it("puts every trusted address in a global servers block at the top", () => {
    const { code, out } = printCaddyfile("--trusted-proxies", "203.0.113.7 2001:db8::7");
    expect(code).toBe(0);
    expect(out).toMatch(
      /^\{\n\tservers \{\n\t\ttrusted_proxies static 203\.0\.113\.7 2001:db8::7\n\t\}\n\}\n/m,
    );
    expect(out.indexOf("trusted_proxies")).toBeLessThan(out.indexOf("example.org {"));
  });

  it("does not compress the survey documents, public definition included", () => {
    const { out } = printCaddyfile();
    expect(out).toContain(
      "@compressible not path /api/v1/surveys/*/definition /api/v1/surveys/*/theme /api/v1/public/surveys/*/definition",
    );
  });

  it("refuses a value that is not a list of addresses", () => {
    const { code, err } = printCaddyfile("--trusted-proxies", "x;y");
    expect(code).not.toBe(0);
    expect(err).toContain("--trusted-proxies");
  });
});
