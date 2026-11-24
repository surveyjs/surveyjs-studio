// `bridge-callers` (the bridge image's launcher): reads the bridge's log on stdin, line by line,
// and writes one CSV row per UTC day, key hash prefix and action to stdout (ADR 0041 point 5),
// e.g. for one day:
//   docker logs --since 2026-11-22T00:00:00Z --until 2026-11-23T00:00:00Z bridge 2>/dev/null \
//     | docker exec -i bridge bridge-callers > callers-2026-11-22.csv
import { createInterface } from "node:readline";
import { createCallerSummary, toCsv } from "../callers.js";

const summary = createCallerSummary();
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  summary.add(line);
}
process.stdout.write(toCsv(summary.rows()));
