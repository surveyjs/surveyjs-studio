import { describe, expect, it } from "vitest";
import type { SurveyResponse } from "../domain/types.js";
import { isAfterResponse } from "./ordering.js";
import {
  foldRuns,
  isInWindow,
  pageOfFoldedRuns,
  pageOfRuns,
  responseOfRun,
  runHolding,
  type ResponseWindow,
  type RunRows,
} from "./runs.js";
import type { ResponsePosition } from "./types.js";

/** A row submitted `minute` minutes into the day. */
const r = (
  id: string,
  minute: number,
  clientId?: string,
  partial = false,
  data: Record<string, unknown> = {},
  respondentIp?: string,
): SurveyResponse => ({
  id,
  submittedAt: new Date(Date.UTC(2026, 10, 19, 0, minute)).toISOString(),
  data,
  partial,
  ...(clientId === undefined ? {} : { clientId }),
  ...(respondentIp === undefined ? {} : { respondentIp }),
});

const ids = (runs: readonly (readonly { id: string }[])[]) =>
  runs.map((run) => run.map((row) => row.id));
const at = (row: SurveyResponse): ResponsePosition => ({
  submittedAt: row.submittedAt,
  id: row.id,
});

describe("foldRuns", () => {
  it("folds partial rows and the complete row after them into one run", () => {
    expect(
      ids(foldRuns([r("p1", 1, "c", true), r("p2", 2, "c", true), r("done3", 3, "c")])),
    ).toEqual([["p1", "p2", "done3"]]);
  });

  it("keeps two complete rows of one client as two runs", () => {
    expect(ids(foldRuns([r("done1", 1, "c"), r("done2", 2, "c")]))).toEqual([["done1"], ["done2"]]);
  });

  it("starts a new run with a partial row after a complete one", () => {
    expect(
      ids(foldRuns([r("p1", 1, "c", true), r("done2", 2, "c"), r("p3", 3, "c", true)])),
    ).toEqual([["p1", "done2"], ["p3"]]);
  });

  it("never folds rows without a client id", () => {
    expect(ids(foldRuns([r("p1", 1, undefined, true), r("done2", 2)]))).toEqual([
      ["p1"],
      ["done2"],
    ]);
  });

  it("folds interleaved clients separately, ordered by first row", () => {
    expect(
      ids(
        foldRuns([
          r("p1", 1, "a", true),
          r("p2", 2, "b", true),
          r("done3", 3, "a"),
          r("done4", 4, "b"),
        ]),
      ),
    ).toEqual([
      ["p1", "done3"],
      ["p2", "done4"],
    ]);
  });
});

describe("runHolding", () => {
  const rows = [
    r("solo1", 1),
    r("p2", 2, "c", true),
    r("x3", 3, "other"),
    r("P4", 4, "c", true),
    r("done5", 5, "c"),
    r("p6", 6, "c", true),
  ];

  it.each(["p2", "P4", "DONE5", "p4"])("finds the whole run by any of its rows (%s)", (id) => {
    expect(runHolding(rows, id)).toEqual({
      run: [rows[1], rows[3], rows[4]],
      laterRun: true,
    });
  });

  it("finds a client's last run, and a row without a client id as a run of one", () => {
    expect(runHolding(rows, "p6")).toEqual({ run: [rows[5]], laterRun: false });
    expect(runHolding(rows, "solo1")).toEqual({ run: [rows[0]], laterRun: false });
    expect(runHolding(rows, "x3")).toEqual({ run: [rows[2]], laterRun: false });
  });

  it("answers null for an id no row has", () => {
    expect(runHolding(rows, "missing")).toBeNull();
    expect(runHolding([], "p2")).toBeNull();
  });
});

describe("responseOfRun", () => {
  it("has the id and time of the first row", () => {
    const first = r("p1", 1, "c", true);
    const response = responseOfRun([first, r("done2", 2, "c")]);
    expect(response.id).toBe("p1");
    expect(response.submittedAt).toBe(first.submittedAt);
    expect(response.clientId).toBe("c");
  });

  it("merges the data in order, later keys winning", () => {
    const run = [r("p1", 1, "c", true, { q1: 1 }), r("done2", 2, "c", false, { q1: 2, q2: 3 })];
    expect(responseOfRun(run).data).toEqual({ q1: 2, q2: 3 });
  });

  it("takes the respondent IP of the last row having one", () => {
    const run = [
      r("p1", 1, "c", true, {}, "10.0.0.1"),
      r("p2", 2, "c", true, {}, "10.0.0.2"),
      r("done3", 3, "c", false, {}),
    ];
    expect(responseOfRun(run).respondentIp).toBe("10.0.0.2");
    expect(responseOfRun([r("p1", 1, "c", true)])).not.toHaveProperty("respondentIp");
  });

  it("is partial only without a complete row", () => {
    expect(responseOfRun([r("p1", 1, "c", true), r("p2", 2, "c", true)]).partial).toBe(true);
    expect(responseOfRun([r("p1", 1, "c", true), r("done2", 2, "c")]).partial).toBe(false);
    expect(responseOfRun([r("done1", 1, "c")]).partial).toBe(false);
  });

  it("does not change the rows", () => {
    const run = [r("p1", 1, "c", true, { q1: 1 }), r("done2", 2, "c", false, { q2: 2 })];
    const before = structuredClone(run);
    const response = responseOfRun(run);
    expect(run).toEqual(before);
    expect(response.data).not.toBe(run[0]!.data);
  });
});

/** An in-memory RunRows that records the client ids and windows it was asked for. */
function fakeRows(
  rows: SurveyResponse[],
): RunRows & { asked: string[][]; windows: ResponseWindow[] } {
  const asked: string[][] = [];
  const windows: ResponseWindow[] = [];
  return {
    asked,
    windows,
    rowsAfter: (after, limit, window) => {
      windows.push(window);
      return Promise.resolve(
        rows
          .filter(
            (row) => (!after || isAfterResponse(row, after)) && isInWindow(row.submittedAt, window),
          )
          .slice(0, limit),
      );
    },
    partialClientRows: (clientIds) => {
      asked.push([...clientIds]);
      const partialClients = new Set(
        rows.filter((row) => row.partial && row.clientId).map((row) => row.clientId),
      );
      return Promise.resolve(
        rows.filter((row) => clientIds.includes(row.clientId!) && partialClients.has(row.clientId)),
      );
    },
  };
}

describe("pageOfRuns", () => {
  const p1 = r("p1", 1, "c", true, { q1: 1 });
  const done2 = r("done2", 2, "c", false, { q2: 2 });
  const done3 = r("done3", 3);
  const done4 = r("done4", 4, "c", false, { q4: 4 });

  it("pages runs by their first row", async () => {
    const source = fakeRows([p1, done2, done3]);
    const page1 = await pageOfRuns(source, { limit: 1 });
    expect(page1.items).toEqual([
      {
        id: "p1",
        submittedAt: p1.submittedAt,
        clientId: "c",
        data: { q1: 1, q2: 2 },
        partial: false,
      },
    ]);
    expect(page1.next).toEqual(at(p1));

    const page2 = await pageOfRuns(source, { limit: 1, after: page1.next! });
    expect(page2.items.map((item) => item.id)).toEqual(["done3"]);
    expect(page2.next).toBeNull();
  });

  it("skips the rest of a run that started before the page", async () => {
    const page = await pageOfRuns(fakeRows([p1, done2, done3]), { limit: 10, after: at(p1) });
    expect(page.items.map((item) => item.id)).toEqual(["done3"]);
    expect(page.next).toBeNull();
  });

  it("leaves out open runs with completedOnly and still pages to the end", async () => {
    const source = fakeRows([
      r("open1", 1, "a", true),
      r("open2", 2, "b", true),
      r("done3", 3),
      r("open4", 4, "d", true),
      r("done5", 5),
    ]);
    const page1 = await pageOfRuns(source, { limit: 1, completedOnly: true });
    expect(page1.items.map((item) => item.id)).toEqual(["done3"]);
    expect(page1.next).toEqual(at(r("done3", 3)));

    const page2 = await pageOfRuns(source, { limit: 1, completedOnly: true, after: page1.next! });
    expect(page2.items.map((item) => item.id)).toEqual(["done5"]);
    expect(page2.next).toBeNull();
  });

  it("keeps a completed run and the partial run after it as two responses", async () => {
    const page = await pageOfRuns(
      fakeRows([r("p1", 1, "c", true), r("done2", 2, "c"), r("p3", 3, "c", true)]),
      { limit: 10 },
    );
    expect(page.items.map((item) => [item.id, item.partial])).toEqual([
      ["p1", false],
      ["p3", true],
    ]);
  });

  it("asks for partial rows only of clients whose rows it read", async () => {
    const source = fakeRows([p1, done2, done3, r("x4", 4, "x", true), r("y5", 5, "y")]);
    await pageOfRuns(source, { limit: 1 });
    const askedFor = source.asked.flat();
    expect(askedFor).toContain("c");
    expect(askedFor).not.toContain("y");
    expect(new Set(askedFor).size).toBe(askedFor.length);
  });

  it("takes a whole run whose complete row is past the rows read", async () => {
    const source = fakeRows([p1, r("x2", 2), r("x3", 3), done4]);
    const page1 = await pageOfRuns(source, { limit: 1 });
    expect(page1.items).toEqual([
      {
        id: "p1",
        submittedAt: p1.submittedAt,
        clientId: "c",
        data: { q1: 1, q4: 4 },
        partial: false,
      },
    ]);
    const page2 = await pageOfRuns(source, { limit: 10, after: page1.next! });
    expect(page2.items.map((item) => item.id)).toEqual(["x2", "x3"]);
  });

  it("asks again for a client whose row was stored after its history was read", async () => {
    const late = r("p3", 3, "c", true, { q3: 3 });
    const all = [p1, done2, late];
    let reads = 0;
    const source: RunRows = {
      rowsAfter: (after, limit) =>
        Promise.resolve(all.filter((row) => !after || isAfterResponse(row, after)).slice(0, limit)),
      // The first read misses the late row, as if it was stored right after.
      partialClientRows: () => Promise.resolve((reads += 1) === 1 ? [p1, done2] : all),
    };
    const page = await pageOfRuns(source, { limit: 1 });
    expect(page.items.map((item) => item.id)).toEqual(["p1"]);
    expect(page.next).toEqual(at(p1));
    expect(reads).toBe(2);
  });

  it("stops when the rows read fall short of the chunk", async () => {
    const source = fakeRows([p1, done2]);
    let calls = 0;
    const counting: RunRows = {
      rowsAfter: (after, limit, window) => {
        calls += 1;
        return source.rowsAfter(after, limit, window);
      },
      partialClientRows: (clientIds) => source.partialClientRows(clientIds),
    };
    const page = await pageOfRuns(counting, { limit: 5 });
    expect(page.items.map((item) => item.id)).toEqual(["p1"]);
    expect(page.next).toBeNull();
    expect(calls).toBe(1);
  });
});

describe("isInWindow", () => {
  const row = r("x", 10).submittedAt;

  it("keeps a time strictly between the bounds", () => {
    expect(isInWindow(row, {})).toBe(true);
    expect(isInWindow(row, { from: r("a", 9).submittedAt, till: r("b", 11).submittedAt })).toBe(
      true,
    );
  });

  it("leaves out a time exactly at either bound", () => {
    expect(isInWindow(row, { from: row })).toBe(false);
    expect(isInWindow(row, { till: row })).toBe(false);
  });

  it("compares as instants, not as text", () => {
    // 00:10 UTC written with an offset and without milliseconds.
    expect(isInWindow(row, { from: "2026-11-19T02:10:00+02:00" })).toBe(false);
    expect(isInWindow(row, { from: "2026-11-19T02:09:59+02:00" })).toBe(true);
    expect(isInWindow(row, { till: "2026-11-19T00:10:00.001Z" })).toBe(true);
  });
});

describe("pageOfRuns in a window", () => {
  const p1 = r("p1", 1, "c", true, { q1: 1 });
  const done3 = r("done3", 3, "c", false, { q3: 3 });
  const x4 = r("x4", 4);
  const p5 = r("p5", 5, "d", true, { q5: 5 });
  const x6 = r("x6", 6);
  const done8 = r("done8", 8, "d", false, { q8: 8 });
  const all = [p1, done3, x4, p5, x6, done8];
  const from = r("", 2).submittedAt;
  const till = r("", 7).submittedAt;

  it("reads rows inside the window only", async () => {
    const source = fakeRows(all);
    await pageOfRuns(source, { limit: 10, from, till });
    expect(source.windows).toEqual([{ from, till }]);
  });

  it("leaves out a run that starts before from, even with its complete row inside", async () => {
    for (const completedOnly of [false, true]) {
      const page = await pageOfRuns(fakeRows(all), { limit: 10, from, till, completedOnly });
      expect(page.items.map((item) => item.id)).toEqual(["x4", "p5", "x6"]);
    }
  });

  it("takes a whole run that starts inside the window and completes after till", async () => {
    const page = await pageOfRuns(fakeRows(all), { limit: 10, from, till, completedOnly: true });
    expect(page.items[1]).toEqual({
      id: "p5",
      submittedAt: p5.submittedAt,
      clientId: "d",
      data: { q5: 5, q8: 8 },
      partial: false,
    });
    expect(page.next).toBeNull();
  });

  it("pages by one inside the window, a cursor before from reading as from", async () => {
    const source = fakeRows(all);
    const page1 = await pageOfRuns(source, { limit: 1, from, till, after: at(p1) });
    expect(page1.items.map((item) => item.id)).toEqual(["x4"]);
    expect(page1.next).toEqual(at(x4));
    const page2 = await pageOfRuns(source, { limit: 1, from, till, after: page1.next! });
    expect(page2.items.map((item) => item.id)).toEqual(["p5"]);
    expect(page2.next).toEqual(at(p5));
    const page3 = await pageOfRuns(source, { limit: 1, from, till, after: page2.next! });
    expect(page3.items.map((item) => item.id)).toEqual(["x6"]);
    expect(page3.next).toBeNull();
  });
});

describe("pageOfFoldedRuns", () => {
  const runs = foldRuns([
    r("p1", 1, "c", true),
    r("open2", 2, "o", true),
    r("done3", 3, "c"),
    r("done4", 4),
  ]);

  it("pages runs after the position by their first row", () => {
    const page1 = pageOfFoldedRuns(runs, { limit: 2 });
    expect(ids(page1.runs)).toEqual([["p1", "done3"], ["open2"]]);
    expect(page1.next).toEqual(at(r("open2", 2)));

    const page2 = pageOfFoldedRuns(runs, { limit: 2, after: page1.next! });
    expect(ids(page2.runs)).toEqual([["done4"]]);
    expect(page2.next).toBeNull();
  });

  it("leaves out open runs with completedOnly", () => {
    const page1 = pageOfFoldedRuns(runs, { limit: 1, completedOnly: true });
    expect(ids(page1.runs)).toEqual([["p1", "done3"]]);
    expect(page1.next).toEqual(at(r("p1", 1)));

    const page2 = pageOfFoldedRuns(runs, { limit: 1, completedOnly: true, after: page1.next! });
    expect(ids(page2.runs)).toEqual([["done4"]]);
    expect(page2.next).toBeNull();
  });

  it("pages runs placed inside the window, leaving out a run started before from", () => {
    const windowed = foldRuns([
      r("p1", 1, "c", true),
      r("x2", 2),
      r("done3", 3, "c"),
      r("p4", 4, "d", true),
      r("done6", 6, "d"),
      r("x7", 7),
    ]);
    const from = r("", 1).submittedAt;
    const till = r("", 7).submittedAt;
    const page1 = pageOfFoldedRuns(windowed, { limit: 1, from, till, completedOnly: true });
    expect(ids(page1.runs)).toEqual([["x2"]]);
    expect(page1.next).toEqual(at(r("x2", 2)));

    const page2 = pageOfFoldedRuns(windowed, { limit: 1, from, till, after: page1.next! });
    expect(ids(page2.runs)).toEqual([["p4", "done6"]]);
    expect(page2.next).toBeNull();
  });
});
