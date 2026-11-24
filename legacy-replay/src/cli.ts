// `pnpm legacy:replay` (ADR 0041 point 3): replays a sample of the old service's reads against the
// old service and the bridge, compares the answers, writes an HTML report outside the repository
// and prints only counts and the verdict. `smoke` runs the write actions with the test account's key
// against both and compares those answers (smoke.ts).
import { readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ACTIONS } from "../../bridge/src/mapping.js";
import { classify, type SkipReason } from "./classify.js";
import { createPacer, realClock, type Clock } from "./pace.js";
import { formatSummary, renderReport, summarize, writeReport } from "./report.js";
import { replay, type CaseResult } from "./run.js";
import { readSample, SampleError, type SampleRow } from "./sample.js";
import { compareSmoke, formatOldOnly, formatSmoke, runSmoke } from "./smoke.js";

export const USAGE = `Usage: pnpm legacy:replay --sample <csv> --old <url> --bridge <url> --out <file.html>
         [--actions a,b] [--since ISO] [--limit n]
         [--public-limit 60] [--file-limit 600] [--summary-limit 10]

Sends each sampled GET whose action the bridge's mapping table marks as a read to the old service,
the bridge, and the old service again, and compares the answers. Writes, forwarded paths, other
methods and paths outside a plain pattern (letters, digits, _ - { } segments) are never sent.
Keys in the sample are sent as recorded; the report shows only their hash
prefixes, and the console only counts and the verdict.

Options:
  --sample <csv>        The sample: columns time,method,path,query,status (query without "?")
  --old <url>           The old service's origin
  --bridge <url>        The bridge's origin
  --out <file.html>     The report; must be outside this repository, in a folder that exists
  --actions a,b         Replay only these actions
  --since <ISO time>    Replay only requests made at or after this time
  --limit <n>           Replay at most n requests
  --public-limit <n>    Bridge requests a minute under Studio's public limit (default 60)
  --file-limit <n>      ... under its file download limit (default 600)
  --summary-limit <n>   ... under its question summary limit (default 10)
  --help, -h            Show this usage and exit

Exit codes: 0 no difference and no error, 1 a difference or a failed request,
2 usage error (nothing sent). Changed and rate-limited cases are counted but do not fail.

Writes: pnpm legacy:replay smoke --old <url> --bridge <url>  (see pnpm legacy:replay smoke --help)`;

export const SMOKE_USAGE = `Usage: SMOKE_ACCESS_KEY=… pnpm legacy:replay smoke --old <url> --bridge <url>

Runs the old service's write actions with the test account's access key (SMOKE_ACCESS_KEY, taken
from the environment only and never printed): create, changeJson, changeName, publish, post twice
(once with a client id), upload, getSurveyResults, deleteResult, deleteAllResults, archive, restore,
delete. It runs against the old service, then against the bridge, each time on a new survey named
"legacy-replay smoke <time>", and compares the answers with ids, dates and generated names
replaced by placeholders. Differences documented in docs/api/legacy-compat.md are set aside only
in their documented form, and each one set aside is printed. When the old service's create does
not succeed, the bridge is not run. Each run deletes only the survey it created; a cleanup that
fails is printed with the survey to remove by hand and does not change the outcome.

Options:
  --old <url>      The old service's origin
  --bridge <url>   The bridge's origin

Exit codes: 0 every step the same, 1 a difference, a failed request or the old create failing,
2 usage error or no SMOKE_ACCESS_KEY (nothing sent).`;

/** This checkout: the report must not be written into it. */
export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export interface CliDeps {
  /**
   * Where a relative `--out` or `--sample` is resolved from: by default the folder the command was
   * typed in (pnpm runs the script from the repository root and passes that folder as `INIT_CWD`).
   */
  cwd?: string;
  fetch?: typeof globalThis.fetch;
  /** Waits for pacing and `Retry-After`. */
  sleep?: Clock["sleep"];
  now?: Clock["now"];
  /** Where `SMOKE_ACCESS_KEY` is read from (default `process.env`). */
  env?: Readonly<Record<string, string | undefined>>;
}

class UsageError extends Error {}

/** The actions the replay can send: the GET entries marked `read`. */
const READ_ACTIONS: ReadonlySet<string> = new Set(
  ACTIONS.filter((entry) => entry.effect === "read" && entry.methods.includes("GET")).map(
    (entry) => entry.action,
  ),
);

/** How many cases between progress lines (and report saves). */
const PROGRESS_EVERY = 100;

interface Options {
  sample: string;
  oldUrl: string;
  bridgeUrl: string;
  out: string;
  actions: ReadonlySet<string> | null;
  since: number | null;
  limit: number;
  limits: { public: number; file: number; summary: number };
}

function origin(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(`--${name} is not a URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError(`--${name} must be an http or https URL`);
  }
  // The sampled path is sent as recorded: a base path, query or fragment would change it.
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "" || /[?#]/.test(value)) {
    throw new UsageError(`--${name} must be an origin, without a path, query or fragment`);
  }
  return url.origin;
}

function positive(name: string, value: string | undefined, fallback: number, integer: boolean) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (value.trim() === "" || !(number > 0) || !Number.isFinite(number)) {
    throw new UsageError(`--${name} must be a positive number`);
  }
  if (integer && !Number.isInteger(number))
    throw new UsageError(`--${name} must be a whole number`);
  return number;
}

function parseOptions(argv: readonly string[]): Options {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  let values: Record<string, string | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...args],
      strict: true,
      allowPositionals: false,
      options: Object.fromEntries(
        [
          "sample",
          "old",
          "bridge",
          "out",
          "actions",
          "since",
          "limit",
          "public-limit",
          "file-limit",
          "summary-limit",
        ].map((name) => [name, { type: "string" as const }]),
      ),
    }) as { values: Record<string, string | undefined> });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  for (const name of ["sample", "old", "bridge", "out"]) {
    if (!values[name]) throw new UsageError(`--${name} is required`);
  }
  let actions: Set<string> | null = null;
  if (values.actions !== undefined) {
    actions = new Set(values.actions.split(",").map((action) => action.trim()));
    const unknown = [...actions].filter((action) => !READ_ACTIONS.has(action));
    if (unknown.length > 0) {
      throw new UsageError(`--actions: not a replayed read: ${unknown.join(", ")}`);
    }
  }
  let since: number | null = null;
  if (values.since !== undefined) {
    since = Date.parse(values.since);
    if (Number.isNaN(since)) throw new UsageError("--since is not a time (ISO 8601)");
  }
  return {
    sample: values.sample!,
    oldUrl: origin("old", values.old!),
    bridgeUrl: origin("bridge", values.bridge!),
    out: values.out!,
    actions,
    since,
    limit: positive("limit", values.limit, Infinity, true),
    limits: {
      public: positive("public-limit", values["public-limit"], 60, false),
      file: positive("file-limit", values["file-limit"], 600, false),
      summary: positive("summary-limit", values["summary-limit"], 10, false),
    },
  };
}

/** Whether `path` is `root` or inside it; letter case ignored on Windows. */
function isInside(path: string, root: string): boolean {
  const fold = (text: string) => (process.platform === "win32" ? text.toLowerCase() : text);
  const rest = relative(fold(root), fold(path));
  return rest === "" || (rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest));
}

/**
 * The report's real path: `out` from `cwd`, through every link. Refused inside the repository,
 * as written (`..` resolved) and as it really is; its folder must exist.
 */
async function reportPath(out: string, cwd: string, repositoryRoot: string): Promise<string> {
  const refusal = () =>
    new UsageError("--out is inside the repository; write the report outside it");
  const roots = [resolve(repositoryRoot), await realpath(repositoryRoot)];
  const written = resolve(cwd, out);
  if (roots.some((root) => isInside(written, root))) throw refusal();
  let real: string;
  try {
    real = await realpath(written);
  } catch {
    let folder: string;
    try {
      folder = await realpath(dirname(written));
    } catch {
      throw new UsageError("--out: its folder does not exist");
    }
    real = join(folder, basename(written));
  }
  if (roots.some((root) => isInside(real, root))) throw refusal();
  return real;
}

const emptySkips = (): Record<SkipReason, number> => ({
  write: 0,
  forwarded: 0,
  "unknown-method": 0,
  "unsafe-path": 0,
});

/** `smoke`: the old service's run first, then the bridge's; returns the exit code. */
async function smoke(argv: readonly string[], io: CliIo, deps: CliDeps): Promise<number> {
  let oldUrl: string;
  let bridgeUrl: string;
  let key: string;
  try {
    let values: { old?: string; bridge?: string; help?: boolean };
    try {
      ({ values } = parseArgs({
        args: [...argv],
        strict: true,
        allowPositionals: false,
        options: {
          old: { type: "string" },
          bridge: { type: "string" },
          help: { type: "boolean" },
        },
      }));
    } catch {
      // Fixed texts only: a key pasted as an argument must not be printed back.
      throw new UsageError("smoke takes only --old <url>, --bridge <url> and --help");
    }
    if (values.help) {
      io.out(`${SMOKE_USAGE}\n`);
      return 0;
    }
    for (const name of ["old", "bridge"] as const) {
      if (!values[name]) throw new UsageError(`--${name} is required`);
    }
    const originOf = (name: "old" | "bridge") => {
      try {
        return origin(name, values[name]!);
      } catch {
        throw new UsageError(
          `--${name} must be an http or https origin, without a path, query or fragment`,
        );
      }
    };
    oldUrl = originOf("old");
    bridgeUrl = originOf("bridge");
    const fromEnv = (deps.env ?? process.env).SMOKE_ACCESS_KEY;
    if (!fromEnv)
      throw new UsageError("SMOKE_ACCESS_KEY is not set: the test account's access key");
    key = fromEnv;
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`${error.message}\n\n${SMOKE_USAGE}\n`);
      return 2;
    }
    throw error;
  }
  const options = deps.fetch ? { fetch: deps.fetch } : {};
  io.err("smoke: the old service\n");
  const old = await runSmoke(oldUrl, key, options);
  if (old.surveyId === undefined) {
    // A wrong key or a service that is down: the bridge would write through for nothing.
    io.out(formatOldOnly(old));
    return 1;
  }
  io.err("smoke: the bridge\n");
  const bridge = await runSmoke(bridgeUrl, key, options);
  const comparison = compareSmoke(old, bridge);
  io.out(formatSmoke(comparison, old, bridge));
  return comparison.verdict === "pass" ? 0 : 1;
}

/** Runs the command; returns the exit code. Nothing is sent before every check has passed. */
export async function main(
  argv: readonly string[],
  io: CliIo,
  deps: CliDeps = {},
): Promise<number> {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args[0] === "smoke") return smoke(args.slice(1), io, deps);
  if (args.includes("--help") || args.includes("-h")) {
    io.out(`${USAGE}\n`);
    return 0;
  }
  const cwd = deps.cwd ?? process.env.INIT_CWD ?? process.cwd();
  let options: Options;
  let out: string;
  let rows: SampleRow[];
  try {
    options = parseOptions(argv);
    out = await reportPath(options.out, cwd, REPOSITORY_ROOT);
    let csv: string;
    try {
      csv = await readFile(resolve(cwd, options.sample), "utf8");
    } catch {
      throw new UsageError("--sample cannot be read");
    }
    rows = readSample(csv);
  } catch (error) {
    if (error instanceof UsageError || error instanceof SampleError) {
      io.err(`${error.message}\n\n${USAGE}\n`);
      return 2;
    }
    throw error;
  }

  const skipped = emptySkips();
  let notSelected = 0;
  const selected: SampleRow[] = [];
  for (const row of rows) {
    const classification = classify(row);
    if (classification.kind === "skip") {
      skipped[classification.reason] += 1;
    } else if (
      (options.actions !== null && !options.actions.has(classification.action)) ||
      (options.since !== null && !(Date.parse(row.time) >= options.since)) ||
      selected.length >= options.limit
    ) {
      notSelected += 1;
    } else {
      selected.push(row);
    }
  }

  // The report is written once before any request, so a folder it cannot be written to stops the
  // run before it starts.
  try {
    await writeFile(out, renderReport([], summarize([], skipped, notSelected)));
  } catch {
    io.err(`--out cannot be written\n\n${USAGE}\n`);
    return 2;
  }

  const clock: Clock = { now: deps.now ?? realClock.now, sleep: deps.sleep ?? realClock.sleep };
  const results: CaseResult[] = [];
  for await (const result of replay(selected, {
    oldUrl: options.oldUrl,
    bridgeUrl: options.bridgeUrl,
    pacer: createPacer(options.limits, clock),
    sleep: clock.sleep,
    ...(deps.fetch && { fetch: deps.fetch }),
  })) {
    results.push(result);
    if (results.length % PROGRESS_EVERY === 0) {
      io.err(`replayed ${results.length} of ${selected.length}\n`);
      await writeReport(out, results, summarize(results, skipped, notSelected));
    }
  }
  const summary = summarize(results, skipped, notSelected);
  await writeReport(out, results, summary);
  io.out(formatSummary(summary));
  return summary.verdict === "fail" ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
