import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./run.js";

const result = run(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
for (const line of result.stdout) console.log(line);
for (const line of result.stderr) console.error(line);
process.exit(result.code);
