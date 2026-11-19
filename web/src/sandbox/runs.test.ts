import { describe, expect, it } from "vitest";
import { foldRuns, responseOfRun } from "./runs";

const row = (id: string, clientId: string | undefined, partial: boolean, data = {}) => ({
  id,
  submittedAt: `2026-01-01T00:00:0${id}.000Z`,
  data,
  partial,
  ...(clientId === undefined ? {} : { clientId }),
});

describe("foldRuns", () => {
  it("folds partial rows and the next complete row of a client into one run", () => {
    const rows = [
      row("1", "a", true),
      row("2", "b", false),
      row("3", "a", false),
      row("4", "a", true),
    ];
    expect(foldRuns(rows).map((run) => run.map((r) => r.id))).toEqual([["1", "3"], ["2"], ["4"]]);
  });

  it("never folds rows without a client id", () => {
    expect(foldRuns([row("1", undefined, true), row("2", undefined, true)])).toHaveLength(2);
  });
});

describe("responseOfRun", () => {
  it("merges the data, takes the first row's id and time, and is partial while open", () => {
    const open = [row("1", "a", true, { q1: 1, q2: 1 }), row("2", "a", true, { q2: 2 })];
    expect(responseOfRun(open)).toEqual({
      id: "1",
      submittedAt: open[0]!.submittedAt,
      data: { q1: 1, q2: 2 },
      clientId: "a",
      partial: true,
    });
    expect(responseOfRun([...open, row("3", "a", false, { q3: 3 })])).toMatchObject({
      data: { q1: 1, q2: 2, q3: 3 },
      partial: false,
    });
  });
});
