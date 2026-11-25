import { describe, expect, it } from "vitest";
import {
  classifyTable,
  distribution,
  formatStats,
  measureContainer,
  newestHistory,
  HISTORY_KEPT,
  type HistoryBlob,
  summariseStats,
  type StatsMeasurements,
} from "./stats.js";

const POST = "post33333333000040008000a00000000001";
const POST_2 = "post33333333000040008000a00000000004";
const POST_DELETE = "postdelete33333333000040008000a00000000001";
const COMPLETION = "SurveyCompletion22222222000040008000a00000000001";

describe("distribution", () => {
  it("gives nearest-rank percentiles, the total and the maximum", () => {
    const values = Array.from({ length: 100 }, (_, i) => 100 - i); // unsorted on purpose
    expect(distribution(values)).toEqual({
      count: 100,
      total: 5050,
      p50: 50,
      p90: 90,
      p99: 99,
      max: 100,
    });
  });

  it("is all zeros for no values", () => {
    expect(distribution([])).toEqual({ count: 0, total: 0, p50: 0, p90: 0, p99: 0, max: 0 });
  });

  it("takes the one value for every percentile", () => {
    expect(distribution([7])).toMatchObject({ p50: 7, p90: 7, p99: 7, max: 7 });
  });
});

describe("classifyTable", () => {
  // By name only: the two storage connection strings may name one account (layout §2.3).
  it("tells the per-survey tables apart", () => {
    expect(classifyTable(POST)).toBe("responses");
    expect(classifyTable(POST_DELETE)).toBe("deletedResponses");
    expect(classifyTable(COMPLETION)).toBe("completionMarkers");
  });

  it("knows the survey event log", () => {
    expect(classifyTable("surveys")).toBe("surveyEvents");
  });

  it("puts anything else in other", () => {
    expect(classifyTable("surveyresulttablestate")).toBe("other");
    expect(classifyTable("post1234")).toBe("other");
    expect(classifyTable("Surveys2")).toBe("other");
  });

  it("is case-insensitive for the hex part, as Azure table names are", () => {
    expect(classifyTable(POST.toUpperCase().replace("POST", "post"))).toBe("responses");
  });
});

describe("measureContainer", () => {
  it("counts blobs and their sizes", () => {
    const measured = measureContainer("surveys", "surveyjson", [
      { name: "a", bytes: 10 },
      { name: "b", bytes: 30 },
    ]);
    expect(measured).toEqual({
      account: "surveys",
      name: "surveyjson",
      blobSizes: [10, 30],
      rootBlobs: 2,
      blobsPerFolder: [],
    });
  });

  it("counts the blobs in each top-level folder, and the ones at the root apart", () => {
    const measured = measureContainer("surveys", "surveyjsonhistory", [
      { name: "s1/p1", bytes: 1 },
      { name: "s1/p2", bytes: 1 },
      { name: "s2/p1", bytes: 1 },
      { name: "orphan-point", bytes: 1 },
    ]);
    expect(measured.rootBlobs).toBe(1);
    expect([...measured.blobsPerFolder].sort()).toEqual([1, 2]);
  });
});

const measurements: StatsMeasurements = {
  sql: {
    users: 6,
    usersWithAccessKey: 4,
    blockedUsers: 1,
    surveys: 9,
    projectSurveys: 3,
    archivedSurveys: 1,
    surveysWithTheme: 2,
    themeBytes: 300,
    projects: 2,
    memberships: 5,
  },
  tables: [
    { account: "results", name: POST, rows: 1500, resultChars: null },
    { account: "results", name: POST_2, rows: 6, resultChars: null },
    { account: "results", name: POST_DELETE, rows: 1, resultChars: null },
    { account: "results", name: COMPLETION, rows: 2, resultChars: null },
    { account: "surveys", name: "surveys", rows: 12, resultChars: null },
    { account: "results", name: "surveyresultcolumns", rows: 0, resultChars: null },
  ],
  containers: [
    measureContainer("surveys", "surveyjson", [
      { name: "a", bytes: 100 },
      { name: "b", bytes: 300 },
    ]),
    measureContainer("surveys", "surveyjsonhistory", [
      { name: "a/1", bytes: 100 },
      { name: "a/2", bytes: 100 },
      { name: "lost", bytes: 50 },
    ]),
  ],
  historyKept: { entries: 23, bytes: 4600 },
  resultBytesMeasured: false,
};

describe("summariseStats", () => {
  const summary = summariseStats(measurements);

  it("keeps the SQL counts and derives the personal surveys", () => {
    expect(summary.sql).toMatchObject({ surveys: 9, projectSurveys: 3, personalSurveys: 6 });
  });

  it("groups the tables by kind, with the rows per table as a distribution", () => {
    expect(summary.tables.responses).toEqual({
      tables: 2,
      rows: distribution([1500, 6]),
      resultChars: null,
    });
    expect(summary.tables.deletedResponses.rows.total).toBe(1);
    expect(summary.tables.completionMarkers.rows.total).toBe(2);
    expect(summary.tables.surveyEvents.rows.total).toBe(12);
    expect(summary.tables.other.tables).toBe(1);
  });

  it("sums the result text only when it was measured", () => {
    const withBytes = summariseStats({
      ...measurements,
      resultBytesMeasured: true,
      tables: [
        { account: "results", name: POST, rows: 2, resultChars: 70 },
        { account: "results", name: POST_2, rows: 1, resultChars: 30 },
      ],
    });
    expect(withBytes.tables.responses.resultChars).toEqual({ total: 100, maxPerTable: 70 });
  });

  it("gives each container its blobs, bytes and folders", () => {
    expect(summary.containers).toEqual([
      {
        account: "surveys",
        name: "surveyjson",
        blobs: 2,
        bytes: distribution([100, 300]),
        rootBlobs: 2,
        blobsPerFolder: distribution([]),
      },
      {
        account: "surveys",
        name: "surveyjsonhistory",
        blobs: 3,
        bytes: distribution([100, 100, 50]),
        rootBlobs: 1,
        blobsPerFolder: distribution([2]),
      },
    ]);
  });
});

describe("formatStats", () => {
  const text = formatStats(summariseStats(measurements));

  it("prints the SQL counts", () => {
    expect(text).toMatch(/^Surveys\s+9 \(personal 6, project 3, archived 1\)$/m);
    expect(text).toMatch(/^Users\s+6 \(with an access key 4, blocked 1\)$/m);
    expect(text).toMatch(/^Projects\s+2 \(memberships 5\)$/m);
  });

  it("prints a line per table kind with its distribution", () => {
    expect(text).toMatch(
      /^Responses \(post\*\)\s+2 tables, 1506 rows; per table p50 6, p90 1500, p99 1500, max 1500$/m,
    );
    expect(text).toContain("Result text: not measured (pass --result-bytes)");
  });

  it("prints a line per container, and the history's points at the root", () => {
    expect(text).toMatch(
      /^surveys\/surveyjson\s+2 blobs, 400 bytes; per blob p50 100, p90 300, p99 300, max 300$/m,
    );
    expect(text).toMatch(/^surveys\/surveyjsonhistory\s+3 blobs, 250 bytes/m);
    expect(text).toContain("1 at the root; per folder p50 2, p90 2, p99 2, max 2");
  });

  it("says that the file shares are not read", () => {
    expect(text).toContain("File shares (surveyfiles, files, tempfiles): not read");
  });
});

describe("newestHistory", () => {
  const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
  const blob = (surveyId: string, n: number, bytes: number, id = `p${n}`): HistoryBlob => ({
    surveyId,
    at: at(n),
    id,
    bytes,
  });

  it("counts a survey with fewer entries whole and the newest HISTORY_KEPT of a longer one", () => {
    const a = [1, 2, 3].map((n) => blob("A", n, 10 + n));
    const b = Array.from({ length: HISTORY_KEPT + 10 }, (_, n) => blob("B", n, 100 + n));
    const newestB = b.slice(-HISTORY_KEPT);
    const result = newestHistory([...a, ...b].reverse());
    expect(result.entries).toBe(a.length + HISTORY_KEPT);
    expect(result.bytes).toBe([...a, ...newestB].reduce((sum, entry) => sum + entry.bytes, 0));
  });

  it("orders entries of the same time by id", () => {
    const entries = [
      { surveyId: "B", at: at(5), id: "a", bytes: 1 },
      { surveyId: "B", at: at(5), id: "c", bytes: 4 },
      { surveyId: "B", at: at(5), id: "b", bytes: 2 },
    ];
    expect(newestHistory(entries, 2)).toEqual({ entries: 2, bytes: 6 });
  });
});

describe("formatStats history line", () => {
  it("prints the newest-per-survey line and no survey id", () => {
    const text = formatStats(summariseStats(measurements));
    expect(text).toContain(`History, newest ${HISTORY_KEPT} per survey: 23 entries, 4600 bytes`);
    expect(text).not.toMatch(/[0-9a-f]{32}/);
  });

  it("prints no history line without a history container", () => {
    const text = formatStats(summariseStats({ ...measurements, historyKept: null }));
    expect(text).not.toContain("History, newest");
  });
});
