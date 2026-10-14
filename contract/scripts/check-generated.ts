import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const committed = join(root, "generated", "openapi.d.ts");
const normalize = (text: string): string => text.replaceAll("\r\n", "\n");
const tempDir = mkdtempSync(join(tmpdir(), "contract-generated-"));

try {
  const fresh = join(tempDir, "openapi.d.ts");
  const bin = join(root, "node_modules", "openapi-typescript", "bin", "cli.js");
  execFileSync(process.execPath, [bin, "openapi.yaml", "-o", fresh], {
    cwd: root,
    stdio: "ignore",
  });
  if (normalize(readFileSync(fresh, "utf8")) !== normalize(readFileSync(committed, "utf8"))) {
    console.error(
      "contract/generated/openapi.d.ts is stale. Run: pnpm --filter @my-surveys/contract generate",
    );
    process.exitCode = 1;
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
