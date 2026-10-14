import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Builds contract/dist/reference.html with Redocly, then replaces the CDN <script src>
// with the inlined Redoc standalone bundle (same pinned `redoc` version) so the page
// is fully self-contained and works offline.
const root = fileURLToPath(new URL("..", import.meta.url));
const output = join(root, "dist", "reference.html");
const cli = join(root, "node_modules", "@redocly", "cli", "bin", "cli.js");

execFileSync(
  process.execPath,
  [cli, "build-docs", "openapi.yaml", "--disableGoogleFont", "-o", output],
  { cwd: root, stdio: "inherit" },
);

const bundle = readFileSync(
  join(root, "node_modules", "redoc", "bundles", "redoc.standalone.js"),
  "utf8",
);
const html = readFileSync(output, "utf8");
const cdnScript = /<script src="https:\/\/cdn\.redocly\.com\/[^"]*"[^>]*><\/script>/;
if (!cdnScript.test(html)) {
  throw new Error("Expected CDN <script> tag not found in generated reference.html");
}
const inlined = bundle.replaceAll("</script", "<\\/script");
writeFileSync(
  output,
  html.replace(cdnScript, () => `<script>${inlined}</script>`),
);
