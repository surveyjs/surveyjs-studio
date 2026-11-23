// `bridge-callers` (the bridge image's launcher): reads the bridge's log on stdin and writes one
// CSV row per UTC day, key hash prefix and action to stdout (ADR 0041 point 5), e.g.
//   docker logs bridge 2>/dev/null | docker exec -i bridge bridge-callers > callers.csv
import { createInterface } from "node:readline";
import { summarizeCallers, toCsv } from "../callers.js";

const lines: string[] = [];
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  lines.push(line);
}
process.stdout.write(toCsv(summarizeCallers(lines)));
