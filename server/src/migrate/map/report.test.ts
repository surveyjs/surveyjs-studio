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

  it("keeps verify's checks, differences and pending items, by ids and counts", () => {
    const report = createReport();
    report.checked("surveys", 2);
    report.difference("surveys", { surveyId: "a" }, { inSource: 0 });
    report.pending("responses", { surveyId: "b", responseId: "c" });
    report.checked("people", 1);
    expect(report.counts()).toEqual({ "difference:surveys": 1, "pending:responses": 1 });
    expect(report.toJSON()).toEqual({
      counts: { "difference:surveys": 1, "pending:responses": 1 },
      skipped: [],
      notes: [],
      checks: {
        surveys: { compared: 2, differences: 1, pending: 0, pass: false },
        responses: { compared: 0, differences: 0, pending: 1, pass: true },
        people: { compared: 1, differences: 0, pending: 0, pass: true },
      },
      differences: [{ check: "surveys", ids: { surveyId: "a" }, counts: { inSource: 0 } }],
      pending: [{ check: "responses", ids: { surveyId: "b", responseId: "c" } }],
    });
  });
});
