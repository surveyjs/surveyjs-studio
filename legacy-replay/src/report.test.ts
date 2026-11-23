import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keyHashPrefix } from "../../bridge/src/callers.js";
import { formatSummary, renderReport, summarize, writeReport } from "./report.js";
import type { CaseResult } from "./run.js";

/** A key's hash prefix, as run.ts puts it in a result. */
const PREFIX = keyHashPrefix("an example key");

const row = (path: string, query = "") => ({
  time: "2026-11-20T10:00:00Z",
  method: "GET",
  path,
  query,
  status: 200,
});

const RESULTS: CaseResult[] = [
  {
    row: row("/private/Surveys/getActive", `accessKey=${PREFIX}…&x=<b>`),
    action: "getActive",
    outcome: "different",
    differences: [{ at: "body.json[0].name", expected: "<script>", actual: null }],
    keyPrefix: PREFIX,
  },
  { row: row("/public/Survey/getSurvey"), action: "getSurvey", outcome: "same", differences: [] },
  {
    row: row("/public/Survey/getSurvey"),
    action: "getSurvey",
    outcome: "error",
    differences: [],
    error: "Error: socket hang up",
  },
  {
    row: row("/public/Survey/getResult"),
    action: "getResult",
    outcome: "changed",
    differences: [],
  },
];
const SKIPPED = { write: 3, forwarded: 2, "unknown-method": 1 };

describe("summarize", () => {
  it("counts the outcomes by action, the skips by reason, and fails on a difference", () => {
    const summary = summarize(RESULTS, SKIPPED, 4);
    expect(summary.actions).toEqual({
      getActive: { same: 0, different: 1, changed: 0, "rate-limited": 0, error: 0 },
      getResult: { same: 0, different: 0, changed: 1, "rate-limited": 0, error: 0 },
      getSurvey: { same: 1, different: 0, changed: 0, "rate-limited": 0, error: 1 },
    });
    expect(summary.skipped).toEqual(SKIPPED);
    expect(summary.notSelected).toBe(4);
    expect(summary.verdict).toBe("different");
    expect(summarize(RESULTS.slice(1), SKIPPED, 0).verdict).toBe("no differences");
  });
});

describe("formatSummary", () => {
  it("holds counts and the verdict only", () => {
    const text = formatSummary(summarize(RESULTS, SKIPPED, 4));
    expect(text).toContain("getActive");
    expect(text).toMatch(/write 3, forwarded 2, unknown-method 1/);
    expect(text).toMatch(/not selected 4/);
    expect(text).toMatch(/verdict: different/);
    expect(text).not.toContain("/private/");
    expect(text).not.toContain(PREFIX);
  });
});

describe("renderReport", () => {
  it("groups the cases by action, shows each difference by its path, and escapes the HTML", () => {
    const html = renderReport(RESULTS, summarize(RESULTS, SKIPPED, 4));
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("<style>");
    const actions = [...html.matchAll(/<h2 id="action-([^"]+)"/g)].map((match) => match[1]);
    expect(actions).toEqual(["getActive", "getResult", "getSurvey"]);
    expect(html).toContain(`GET /private/Surveys/getActive?accessKey=${PREFIX}…&amp;x=&lt;b&gt;`);
    expect(html).toContain("body.json[0].name");
    expect(html).toContain("&quot;&lt;script&gt;&quot;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("Error: socket hang up");
  });
});

describe("writeReport", () => {
  it("writes the report to the file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "legacy-replay-report-"));
    try {
      const path = join(dir, "report.html");
      await writeReport(path, RESULTS, summarize(RESULTS, SKIPPED, 0));
      expect(await readFile(path, "utf8")).toContain("getActive");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
