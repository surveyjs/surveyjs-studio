import { describe, expect, it } from "vitest";
import { extraTableColumns, summaryData, tableRows } from "./tableRows";

const base = { id: "r1", submittedAt: "2026-01-01T00:00:00.000Z", data: { q1: 1 } };
const withIp = { ...base, id: "r2", respondentIp: "10.0.0.1" };

describe("tableRows", () => {
  it("adds the submission time and the IP address only when present", () => {
    expect(tableRows([base, withIp], new Set(["q1"]))).toEqual([
      { q1: 1, HappendAt: base.submittedAt },
      { q1: 1, HappendAt: base.submittedAt, IPAddress: "10.0.0.1" },
    ]);
  });

  it("reads an item without an id", () => {
    const item = { submittedAt: base.submittedAt, data: { q1: 2 } };
    expect(tableRows([item], new Set(["q1"]))).toEqual([{ q1: 2, HappendAt: base.submittedAt }]);
  });

  it("keeps the answer of a question named like an extra column", () => {
    const response = { ...withIp, data: { HappendAt: "mine", IPAddress: "yours" } };
    expect(tableRows([response], new Set(["HappendAt", "IPAddress"]))).toEqual([
      { HappendAt: "mine", IPAddress: "yours" },
    ]);
  });
});

describe("extraTableColumns", () => {
  it("lists Submitted, and IPAddress when any response has one", () => {
    expect(extraTableColumns([base], new Set())).toEqual([
      { name: "HappendAt", displayName: "Submitted", isVisible: true },
    ]);
    expect(extraTableColumns([base, withIp], new Set())).toEqual([
      { name: "HappendAt", displayName: "Submitted", isVisible: true },
      { name: "IPAddress", displayName: "IPAddress", isVisible: true },
    ]);
  });

  it("leaves out a private extra column, and its cells (the public page: the submit time)", () => {
    const hidden = new Set(["HappendAt", "q2"]);
    expect(extraTableColumns([base], new Set(["q1"]), hidden)).toEqual([]);
    expect(tableRows([base], new Set(["q1"]), hidden)).toEqual([{ q1: 1 }]);
  });

  it("skips a column a question already uses", () => {
    expect(extraTableColumns([withIp], new Set(["HappendAt"]))).toEqual([
      { name: "IPAddress", displayName: "IPAddress", isVisible: true },
    ]);
  });
});

describe("summaryData", () => {
  it("returns the data objects only", () => {
    expect(summaryData([base, withIp])).toEqual([{ q1: 1 }, { q1: 1 }]);
  });
});

describe("partial responses", () => {
  const partial = { ...base, id: "r3", partial: true };

  it("adds the Partial column after IPAddress only with a partial response", () => {
    expect(extraTableColumns([base], new Set()).map((c) => c.name)).not.toContain("Partial");
    expect(extraTableColumns([withIp, partial], new Set()).map((c) => c.name)).toEqual([
      "HappendAt",
      "IPAddress",
      "Partial",
    ]);
    expect(extraTableColumns([partial], new Set(["Partial"]))).toEqual([
      { name: "HappendAt", displayName: "Submitted", isVisible: true },
    ]);
  });

  it('fills "Yes" for a partial response and nothing otherwise', () => {
    expect(tableRows([base, partial], new Set(["q1"]))).toEqual([
      { q1: 1, HappendAt: base.submittedAt },
      { q1: 1, HappendAt: base.submittedAt, Partial: "Yes" },
    ]);
  });

  it("leaves partial responses out of the summary", () => {
    expect(summaryData([base, { ...partial, data: { q1: 9 } }])).toEqual([{ q1: 1 }]);
  });
});
