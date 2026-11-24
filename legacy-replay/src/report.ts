// The replay's outputs (ADR 0041 point 3): the counts and the verdict for the console, which may be
// quoted in a PR, and one HTML report with every case, for the operator only (outside the
// repository). The results it is given already hold keys only as hash prefixes (run.ts).
import { writeFile } from "node:fs/promises";
import type { SkipReason } from "./classify.js";
import { OUTCOMES, type CaseResult, type Outcome } from "./run.js";

export const SKIP_REASONS: readonly SkipReason[] = [
  "write",
  "forwarded",
  "unknown-method",
  "unsafe-path",
];

export interface Summary {
  /** By action (sorted), the number of cases of each outcome. */
  actions: Record<string, Record<Outcome, number>>;
  skipped: Record<SkipReason, number>;
  /** Replayable rows left out by `--actions`, `--since` or `--limit`. */
  notSelected: number;
  /**
   * `fail` when any case is `different` or an `error` (the command then exits 1); `changed` and
   * `rate-limited` cases are counted but do not fail.
   */
  verdict: "pass" | "fail";
  /** The actions whose old answers mostly changed between their two calls (`VARIES`). */
  varies: string[];
}

/** An action varies when more than half of its cases, and at least this many, are `changed`. */
const VARIES_MIN_CASES = 5;

/** The verdict line's reason: the counts that decide it. */
function verdictText(summary: Summary): string {
  const total = (outcome: Outcome) =>
    Object.values(summary.actions).reduce((sum, counts) => sum + counts[outcome], 0);
  const errors = total("error");
  if (summary.verdict === "pass") return "pass";
  return `fail (${total("different")} different, ${errors} error${errors === 1 ? "" : "s"})`;
}

export function summarize(
  results: readonly CaseResult[],
  skipped: Record<SkipReason, number>,
  notSelected: number,
): Summary {
  const actions: Record<string, Record<Outcome, number>> = {};
  for (const action of [...new Set(results.map((result) => result.action))].sort()) {
    actions[action] = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])) as Record<
      Outcome,
      number
    >;
  }
  for (const result of results) actions[result.action]![result.outcome] += 1;
  const fails = results.some(
    (result) => result.outcome === "different" || result.outcome === "error",
  );
  const varies = Object.entries(actions)
    .filter(([, counts]) => {
      const cases = OUTCOMES.reduce((sum, outcome) => sum + counts[outcome], 0);
      return cases >= VARIES_MIN_CASES && counts.changed * 2 > cases;
    })
    .map(([action]) => action);
  return {
    actions,
    skipped: { ...skipped },
    notSelected,
    verdict: fails ? "fail" : "pass",
    varies,
  };
}

/**
 * The console's text: counts per action and outcome (an action whose old answers mostly vary is
 * flagged, as nothing of it was compared), the skips, and the verdict; nothing else.
 */
export function formatSummary(summary: Summary): string {
  const header = ["action", ...OUTCOMES];
  const rows = Object.entries(summary.actions).map(([action, counts]) => [
    action,
    ...OUTCOMES.map((outcome) => String(counts[outcome])),
  ]);
  const flag = (row: string[]) =>
    summary.varies.includes(row[0]!) ? "  old service varies — compared nothing" : "";
  const widths = header.map((name, column) =>
    Math.max(name.length, ...rows.map((row) => row[column]!.length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, column) =>
        column === 0 ? cell.padEnd(widths[0]!) : cell.padStart(widths[column]!),
      )
      .join("  ");
  const skipped = SKIP_REASONS.map((reason) => `${reason} ${summary.skipped[reason]}`).join(", ");
  return [
    line(header),
    ...rows.map((row) => line(row) + flag(row)),
    "",
    `skipped: ${skipped}; not selected ${summary.notSelected}`,
    `verdict: ${verdictText(summary)}`,
    "",
  ].join("\n");
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );

/** How much of a difference's value the report shows. */
const SHOWN = 2000;

function shown(value: unknown): string {
  const text = value === undefined ? "(none)" : JSON.stringify(value);
  return text.length > SHOWN ? `${text.slice(0, SHOWN)}… (${text.length} characters)` : text;
}

const STYLE = `
:root { color-scheme: light dark; --fg: #1d1d1f; --bg: #fff; --muted: #6b6b70; --line: #d8d8dc;
  --bad: #b3261e; --warn: #8a5a00; --good: #1b6e3a; }
@media (prefers-color-scheme: dark) { :root { --fg: #ececf0; --bg: #17171a; --muted: #a0a0a8;
  --line: #3a3a40; --bad: #ff8a80; --warn: #ffc56b; --good: #7fd69b; } }
body { margin: 0; padding: 1.5rem 1rem; font: 14px/1.45 system-ui, sans-serif; color: var(--fg);
  background: var(--bg); }
main { max-width: 72rem; margin: 0 auto; }
table { border-collapse: collapse; margin: 0.5rem 0 1rem; }
th, td { border-bottom: 1px solid var(--line); padding: 0.25rem 0.75rem 0.25rem 0; text-align: left;
  vertical-align: top; }
td.n { text-align: right; font-variant-numeric: tabular-nums; }
code, pre { font: 12px/1.4 ui-monospace, monospace; }
pre { margin: 0; white-space: pre-wrap; word-break: break-all; }
.case { border-top: 1px solid var(--line); padding: 0.5rem 0; }
.different, .error { color: var(--bad); } .changed, .rate-limited { color: var(--warn); }
.same { color: var(--good); } .muted { color: var(--muted); }
.wide { overflow-x: auto; }
`;

/** The report: the summary, then the cases grouped by action, each difference by its path. */
export function renderReport(results: readonly CaseResult[], summary: Summary): string {
  const parts: string[] = [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Legacy replay</title><style>${STYLE}</style></head><body><main>`,
    "<h1>Legacy replay</h1>",
    `<p>Verdict: <strong class="${summary.verdict === "fail" ? "different" : "same"}">${escapeHtml(verdictText(summary))}</strong></p>`,
    '<div class="wide"><table><tr><th>Action</th>',
    ...OUTCOMES.map((outcome) => `<th>${outcome}</th>`),
    "<th></th></tr>",
  ];
  for (const [action, counts] of Object.entries(summary.actions)) {
    parts.push(
      `<tr><td><a href="#action-${escapeHtml(action)}">${escapeHtml(action)}</a></td>`,
      ...OUTCOMES.map((outcome) => `<td class="n">${counts[outcome]}</td>`),
      summary.varies.includes(action)
        ? '<td class="changed">old service varies — compared nothing</td></tr>'
        : "<td></td></tr>",
    );
  }
  parts.push(
    "</table></div>",
    `<p class="muted">Skipped: ${SKIP_REASONS.map((reason) => `${reason} ${summary.skipped[reason]}`).join(", ")}; not selected ${summary.notSelected}.</p>`,
  );
  for (const action of Object.keys(summary.actions)) {
    parts.push(`<h2 id="action-${escapeHtml(action)}">${escapeHtml(action)}</h2>`);
    for (const result of results.filter((item) => item.action === action)) {
      const { row } = result;
      const request = `${row.method} ${row.path}${row.query === "" ? "" : `?${row.query}`}`;
      parts.push(
        '<div class="case">',
        `<div><span class="${result.outcome}">${result.outcome}</span> <span class="muted">${escapeHtml(row.time)}</span> <code>${escapeHtml(request)}</code></div>`,
      );
      if (result.error !== undefined)
        parts.push(`<pre class="error">${escapeHtml(result.error)}</pre>`);
      if (result.differences.length > 0) {
        parts.push(
          '<div class="wide"><table><tr><th>At</th><th>Old service</th><th>Bridge</th></tr>',
        );
        for (const difference of result.differences) {
          parts.push(
            `<tr><td><code>${escapeHtml(difference.at)}</code></td>`,
            `<td><pre>${escapeHtml(shown(difference.expected))}</pre></td>`,
            `<td><pre>${escapeHtml(shown(difference.actual))}</pre></td></tr>`,
          );
        }
        parts.push("</table></div>");
      }
      parts.push("</div>");
    }
  }
  parts.push("</main></body></html>", "");
  return parts.join("\n");
}

export async function writeReport(
  path: string,
  results: readonly CaseResult[],
  summary: Summary,
): Promise<void> {
  await writeFile(path, renderReport(results, summary));
}
