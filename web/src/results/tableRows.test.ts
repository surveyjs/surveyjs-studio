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
