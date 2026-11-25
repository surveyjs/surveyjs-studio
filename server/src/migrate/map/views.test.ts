import { describe, expect, it } from "vitest";
import { createReport } from "./report.js";
import { mapView } from "./views.js";

const S = "0A1B2C3D-0000-4000-8000-00000000000A";
const U = "0A1B2C3D-0000-4000-8000-00000000000B";
const at = new Date("2026-01-02T03:04:05.678Z");

describe("mapView", () => {
  it("maps a saved layout with lower-case ids and the exact time, BOM removed", () => {
    const report = createReport();
    expect(mapView(`${S}/${U}/table`, '﻿{"a":1}', at, report)).toEqual({
      surveyId: S.toLowerCase(),
      userId: U.toLowerCase(),
      view: "table",
      state: { a: 1 },
      updatedAt: "2026-01-02T03:04:05.678Z",
    });
    expect(report.counts()).toEqual({});
  });

  it("maps a reset marker (empty text) to no state, unreported", () => {
    const report = createReport();
    expect(mapView(`${S}/${U}/summary`, "", at, report)?.state).toBeNull();
    expect(report.counts()).toEqual({});
  });

  it("keeps the record with no state for text that is not an object, and reports it", () => {
    const report = createReport();
    expect(mapView(`${S}/${U}/summary`, "[1]", at, report)?.state).toBeNull();
    expect(report.counts()).toEqual({ view_unreadable: 1 });
  });

  it("replaces NUL in strings and reports it", () => {
    const report = createReport();
    const view = mapView(`${S}/${U}/summary`, '{"a":"x\\u0000y"}', at, report);
    expect(view?.state).toEqual({ a: "x�y" });
    expect(report.counts()).toEqual({ nul_replaced: 1 });
  });

  it("skips names that are not survey/user/view with GUIDs", () => {
    const report = createReport();
    expect(mapView("x/y/table", "{}", at, report)).toBeNull();
    expect(mapView(`${S}/${U}/other`, "{}", at, report)).toBeNull();
    expect(report.counts()).toEqual({ "skipped:view": 2 });
  });
});
