// Writes web/src/sandbox/seed.json from the shared fixtures: `pnpm sandbox:seed`.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sandboxSeed, seedJson } from "./generate.js";

const out = resolve(import.meta.dirname, "../../web/src/sandbox/seed.json");
const text = seedJson(await sandboxSeed());
writeFileSync(out, text);
console.log(`${out}: ${Buffer.byteLength(text)} bytes`);
