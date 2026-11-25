// `pnpm scale:check`: times the HTTP API of a running server against the scale targets
// (ADR 0033, Readiness). The output has one line per operation and no ids.
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export interface Timing {
  readonly operation: string;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly targetMs: number;
  readonly met: boolean;
}

export const CHECK_USAGE =
  "usage: scale:check --base <url> --token <sjs_ API token of the owner> --survey <largest survey id> [--runs <n, default 20>]";

/** Targets in milliseconds (ADR 0033, Readiness). */
export const TARGETS = {
  listSurveys: 500,
  listResults: 2_000,
  exportFirstByte: 1_000,
  exportTotal: 600_000,
  saveSurveyDefinition: 500,
} as const;

/** The value at the percentile of the samples (nearest rank). */
export function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

const timing = (operation: string, samples: number[], targetMs: number): Timing => {
  const p50Ms = percentile(samples, 50);
  const p95Ms = percentile(samples, 95);
  return { operation, p50Ms, p95Ms, targetMs, met: p95Ms < targetMs };
};

async function timed(action: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await action();
  return performance.now() - started;
}

/** A path with its ids left out, for error messages. */
const shown = (url: string): string => new URL(url).pathname.replace(/[0-9a-f-]{36}/g, ":id");

export async function check(options: {
  base: string;
  token: string;
  surveyId: string;
  runs: number;
}): Promise<Timing[]> {
  const api = `${options.base.replace(/\/+$/, "")}/api/v1`;
  const headers = { authorization: `Bearer ${options.token}` };
  const survey = `${api}/surveys/${encodeURIComponent(options.surveyId)}`;
  const get = async (url: string): Promise<Response> => {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`GET ${shown(url)}: ${response.status}`);
    return response;
  };
  const repeat = async (action: () => Promise<number>): Promise<number[]> => {
    const samples: number[] = [];
    for (let i = 0; i < options.runs; i++) samples.push(await action());
    return samples;
  };

  const listSurveys = await repeat(() =>
    timed(async () => (await get(`${api}/surveys`)).arrayBuffer()),
  );
  const listResults = await repeat(() =>
    timed(async () => (await get(`${survey}/results`)).arrayBuffer()),
  );

  // The export once: the time until the first chunk, and until the stream ends.
  const started = performance.now();
  const exported = await get(`${survey}/results/export?format=csv`);
  const reader = exported.body!.getReader();
  await reader.read();
  const firstByte = performance.now() - started;
  while (!(await reader.read()).done) {
    // drain the rest
  }
  const total = performance.now() - started;

  const save = await repeat(async () => {
    const current = await get(`${survey}/definition`);
    const etag = current.headers.get("etag") ?? "*";
    const definition = (await current.json()) as Record<string, unknown>;
    const body = JSON.stringify({ ...definition, scaleCheckAt: Date.now() });
    return timed(async () => {
      const response = await fetch(`${survey}/definition`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json", "if-match": etag },
        body,
      });
      if (!response.ok) throw new Error(`PUT ${shown(`${survey}/definition`)}: ${response.status}`);
      await response.arrayBuffer();
    });
  });

  return [
    timing("listSurveys", listSurveys, TARGETS.listSurveys),
    timing("listResults (first page)", listResults, TARGETS.listResults),
    timing("exportResults CSV (first byte)", [firstByte], TARGETS.exportFirstByte),
    timing("exportResults CSV (total)", [total], TARGETS.exportTotal),
    timing("saveSurveyDefinition", save, TARGETS.saveSurveyDefinition),
  ];
}

/** The printed table: one line per operation. */
export function formatTimings(timings: readonly Timing[]): string {
  return timings
    .map(
      (t) =>
        `${t.met ? "ok  " : "FAIL"} ${t.operation.padEnd(32)} p50 ${t.p50Ms.toFixed(0).padStart(7)} ms  p95 ${t.p95Ms.toFixed(0).padStart(7)} ms  target < ${t.targetMs} ms`,
    )
    .join("\n");
}

/** The command: exit 0 when every target is met, 1 when one is not, 2 for a usage problem. */
export async function run(
  args: readonly string[],
): Promise<{ code: number; out: string; err: string }> {
  let values: Record<string, string | undefined>;
  try {
    values = parseArgs({
      args: [...args],
      options: {
        base: { type: "string" },
        token: { type: "string" },
        survey: { type: "string" },
        runs: { type: "string" },
      },
    }).values;
  } catch (error) {
    return { code: 2, out: "", err: `${(error as Error).message}\n${CHECK_USAGE}\n` };
  }
  const runs = values.runs === undefined ? 20 : Number(values.runs);
  if (!values.base || !values.token || !values.survey || !Number.isInteger(runs) || runs < 1) {
    return {
      code: 2,
      out: "",
      err: `--base, --token and --survey are required; --runs is a positive whole number\n${CHECK_USAGE}\n`,
    };
  }
  try {
    const timings = await check({
      base: values.base,
      token: values.token,
      surveyId: values.survey,
      runs,
    });
    return {
      code: timings.every((t) => t.met) ? 0 : 1,
      out: `${formatTimings(timings)}\n`,
      err: "",
    };
  } catch (error) {
    return { code: 1, out: "", err: `${(error as Error).message}\n` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await run(process.argv.slice(2).filter((arg) => arg !== "--"));
  process.stdout.write(result.out);
  process.stderr.write(result.err);
  process.exitCode = result.code;
}
