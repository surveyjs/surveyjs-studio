import { describe, expect, it } from "vitest";
import { createReport } from "./report.js";

describe("createReport", () => {
  it("counts skips and notes and serialises ids and reasons only", () => {
    const report = createReport();
    report.skip("survey", { surveyId: "a" }, "an id is not a GUID");
    report.skip("survey", { surveyId: "b" }, "x");
    report.note("person_without_email", { userId: "c" });
    expect(report.counts()).toEqual({ "skipped:survey": 2, person_without_email: 1 });
    expect(report.toJSON()).toEqual({
      counts: { "skipped:survey": 2, person_without_email: 1 },
      skipped: [
        { entity: "survey", ids: { surveyId: "a" }, reason: "an id is not a GUID" },
        { entity: "survey", ids: { surveyId: "b" }, reason: "x" },
      ],
      notes: [{ kind: "person_without_email", ids: { userId: "c" } }],
    });
  });
});
