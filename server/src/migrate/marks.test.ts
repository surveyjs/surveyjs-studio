import { describe, expect, it } from "vitest";
import {
  changedAfterMarks,
  isCompleteMarks,
  markOf,
  MARKS_MARGIN_MS,
  takeMarks,
  type HighWaterMarks,
} from "./marks.js";
import { createReport } from "./map/report.js";
import type { LegacySource } from "./source/index.js";

const NOW = new Date("2026-11-25T12:00:00.500Z");
const now = () => NOW;
const minus = (at: string, ms: number) => new Date(Date.parse(at) - ms).toISOString();

interface Clocks {
  latest: Record<"users" | "surveys" | "organizations" | "organizationUsers", Date | null>;
  /** The SQL server's clock; default NOW. */
  sqlNow?: Date;
  tables: Date | null;
  blobs: Date | null;
}

/** A source that answers only what `takeMarks` asks. */
function sourceWith(clocks: Clocks): LegacySource {
  return {
    latestChanges: () => Promise.resolve({ ...clocks.latest, now: clocks.sqlNow ?? NOW }),
    tablesClock: () => Promise.resolve(clocks.tables),
    blobsClock: () => Promise.resolve(clocks.blobs),
  } as unknown as LegacySource;
}

const LATEST: Clocks["latest"] = {
  users: new Date("2026-11-20T08:00:00.000Z"),
  surveys: new Date("2026-11-25T11:58:00.000Z"),
  organizations: new Date("2026-10-01T00:00:00.000Z"),
  organizationUsers: new Date("2026-11-24T23:00:00.000Z"),
};

describe("takeMarks", () => {
  it("keeps a five-minute safety margin", () => {
    expect(MARKS_MARGIN_MS).toBe(5 * 60_000);
  });

  it("takes each SQL table's own latest change time, minus the margin", async () => {
    const marks = await takeMarks(sourceWith({ latest: LATEST, tables: NOW, blobs: NOW }), now);
    expect(marks.takenAt).toBe(NOW.toISOString());
    for (const table of ["users", "surveys", "organizations", "organizationUsers"] as const) {
      expect(marks.sql[table], table).toBe(minus(LATEST[table]!.toISOString(), MARKS_MARGIN_MS));
    }
  });

  it("starts an empty SQL table (no change time) at the epoch", async () => {
    const marks = await takeMarks(
      sourceWith({ latest: { ...LATEST, organizations: null }, tables: NOW, blobs: NOW }),
      now,
    );
    expect(marks.sql.organizations).toBe(new Date(0).toISOString());
  });

  it("takes the tables' and the blobs' service clocks, minus the margin", async () => {
    const tables = new Date(NOW.getTime() - 3_000);
    const blobs = new Date(NOW.getTime() - 7_000);
    const marks = await takeMarks(sourceWith({ latest: LATEST, tables, blobs }), now);
    expect(marks.tables).toBe(minus(tables.toISOString(), MARKS_MARGIN_MS));
    expect(marks.blobs).toBe(minus(blobs.toISOString(), MARKS_MARGIN_MS));
  });

  it("takes the tool's clock when a service clock is ahead of it or gives no time", async () => {
    const ahead = new Date(NOW.getTime() + 60_000);
    const marks = await takeMarks(sourceWith({ latest: LATEST, tables: ahead, blobs: null }), now);
    expect(marks.tables).toBe(minus(NOW.toISOString(), MARKS_MARGIN_MS));
    expect(marks.blobs).toBe(minus(NOW.toISOString(), MARKS_MARGIN_MS));
  });

  it("caps a SQL table's mark at the SQL server's clock, noting a change time in the future", async () => {
    const sqlNow = new Date("2026-11-25T11:59:00.000Z");
    const future = new Date("2027-01-01T00:00:00.000Z");
    const report = createReport();
    const marks = await takeMarks(
      sourceWith({ latest: { ...LATEST, surveys: future }, sqlNow, tables: NOW, blobs: NOW }),
      now,
      { report },
    );
    expect(marks.sql.surveys).toBe(minus(sqlNow.toISOString(), MARKS_MARGIN_MS));
    // The other tables keep their own latest change time.
    expect(marks.sql.users).toBe(minus(LATEST.users!.toISOString(), MARKS_MARGIN_MS));
    expect(report.toJSON()).toMatchObject({
      notes: [{ kind: "future_change_time", ids: { table: "surveys" } }],
    });
  });

  it("takes another margin when one is given (tests)", async () => {
    const marks = await takeMarks(sourceWith({ latest: LATEST, tables: NOW, blobs: NOW }), now, {
      marginMs: 0,
    });
    expect(marks.tables).toBe(NOW.toISOString());
    expect(marks.sql.surveys).toBe(LATEST.surveys!.toISOString());
  });
});

describe("marks per store", () => {
  const marks: HighWaterMarks = {
    takenAt: "2026-11-25T12:05:00.500Z",
    sql: {
      users: "2026-11-20T08:00:00.000Z",
      surveys: "2026-11-25T11:53:00.000Z",
      organizations: "2026-10-01T00:00:00.000Z",
      organizationUsers: "2026-11-24T23:00:00.000Z",
    },
    tables: "2026-11-25T12:00:00.500Z",
    blobs: "2026-11-25T12:00:00.500Z",
  };

  it("judges each SQL table by its own mark", () => {
    const at = "2026-11-21T00:00:00.000Z";
    expect(changedAfterMarks(marks, "users", at)).toBe(true);
    expect(changedAfterMarks(marks, "surveys", at)).toBe(false);
    expect(changedAfterMarks(marks, "organizations", at)).toBe(true);
    expect(changedAfterMarks(marks, "organizationUsers", at)).toBe(false);
    expect(markOf(marks, "surveys").toISOString()).toBe(marks.sql.surveys);
  });

  it("counts a table row at the mark itself as after it (inclusive)", () => {
    expect(changedAfterMarks(marks, "tables", "2026-11-25T12:00:00.400Z")).toBe(false);
    expect(changedAfterMarks(marks, "tables", "2026-11-25T12:00:00.500Z")).toBe(true);
    expect(changedAfterMarks(marks, "tables", "2026-11-25T12:00:00.600Z")).toBe(true);
    expect(markOf(marks, "tables").toISOString()).toBe("2026-11-25T12:00:00.499Z");
  });

  it("counts a blob of the mark's second as after it (blob times are whole seconds)", () => {
    expect(changedAfterMarks(marks, "blobs", new Date("2026-11-25T12:00:00.000Z"))).toBe(true);
    expect(changedAfterMarks(marks, "blobs", new Date("2026-11-25T11:59:59.000Z"))).toBe(false);
    expect(markOf(marks, "blobs").toISOString()).toBe("2026-11-25T11:59:59.999Z");
  });

  it("takes a missing time as no change after the marks", () => {
    expect(changedAfterMarks(marks, "surveys", null)).toBe(false);
    expect(changedAfterMarks(marks, "tables", undefined)).toBe(false);
  });

  it("tells marks with every part from the time-only ones of an earlier run", () => {
    expect(isCompleteMarks(marks)).toBe(true);
    expect(isCompleteMarks({ takenAt: marks.takenAt })).toBe(false);
    expect(isCompleteMarks(null)).toBe(false);
  });
});
