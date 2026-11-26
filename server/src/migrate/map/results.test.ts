import { describe, expect, it } from "vitest";
import type { LegacyResultEntity } from "../../providers/azure-legacy/rows.js";
import { createReport } from "./report.js";
import { mapDeleted, mapHistory, mapMarker, mapResponse } from "./results.js";

const S = "0A1B2C3D-0000-4000-8000-00000000000A";
const R = "0A1B2C3D-0000-4000-8000-0000000000FF";
const entity = (result: string, extra: Partial<LegacyResultEntity> = {}): LegacyResultEntity => ({
  id: R,
  happendat: new Date("2026-03-04T05:06:07.089Z"),
  result,
  ...extra,
});

describe("mapResponse", () => {
  it("maps a response: lower-case ids, exact time, client id kept as stored", () => {
    const rec = mapResponse(
      S,
      entity('{"q":1}', { clientid: "ABC-Def", ispartialcompleted: true }),
      createReport(),
    );
    expect(rec).toEqual({
      surveyId: S.toLowerCase(),
      response: {
        id: R.toLowerCase(),
        submittedAt: "2026-03-04T05:06:07.089Z",
        data: { q: 1 },
        clientId: "ABC-Def",
        partial: true,
      },
    });
  });

  it("removes a BOM before parsing", () => {
    const report = createReport();
    expect(mapResponse(S, entity('﻿{"q":1}'), report)?.response.data).toEqual({ q: 1 });
    expect(report.counts()).toEqual({});
  });

  it("replaces NUL in strings with U+FFFD and reports it by id", () => {
    const report = createReport();
    const rec = mapResponse(S, entity('{"q":"a\\u0000b","n":{"k":["\\u0000"]}}'), report);
    expect(rec?.response.data).toEqual({ q: "a�b", n: { k: ["�"] } });
    expect(report.toJSON()).toMatchObject({
      notes: [
        { kind: "nul_replaced", ids: { surveyId: S.toLowerCase(), responseId: R.toLowerCase() } },
      ],
    });
  });

  it("skips and reports a result that is not a JSON object, an id that is not a GUID", () => {
    const report = createReport();
    expect(mapResponse(S, entity("[1]"), report)).toBeNull();
    expect(mapResponse(S, entity("nope"), report)).toBeNull();
    expect(mapResponse(S, { ...entity("{}"), id: "x" }, report)).toBeNull();
    expect(report.counts()).toEqual({ "skipped:response": 3 });
  });

  it("skips and reports a row whose time is not a date, as the app's reader skips it", () => {
    const report = createReport();
    expect(mapResponse(S, { ...entity("{}"), happendat: null }, report)).toBeNull();
    expect(report.toJSON()).toMatchObject({
      skipped: [
        {
          entity: "response",
          ids: { surveyId: S.toLowerCase(), responseId: R.toLowerCase() },
          reason: "the time is not a date",
        },
      ],
    });
  });

  it("keeps the row key as the id and reports a row whose id property differs", () => {
    const report = createReport();
    const other = "0A1B2C3D-0000-4000-8000-0000000000EE";
    expect(mapResponse(S, { ...entity("{}"), idProperty: R }, report)?.response.id).toBe(
      R.toLowerCase(),
    );
    expect(report.counts()).toEqual({});
    const rec = mapResponse(S, { ...entity("{}"), idProperty: other }, report);
    expect(rec?.response.id).toBe(R.toLowerCase());
    expect(report.toJSON()).toMatchObject({
      notes: [
        {
          kind: "response_id_differs",
          ids: { surveyId: S.toLowerCase(), responseId: R.toLowerCase() },
        },
      ],
    });
  });
});

describe("mapDeleted", () => {
  it("keeps data, client id, partial flag and IP in one JSON object; deleted_at is the copy's time", () => {
    const copy = {
      responseId: R,
      deletedAt: new Date("2026-04-01T00:00:00.000Z"),
      entity: entity('{"q":1}', { clientid: "c", ipaddress: "1.2.3.4", ispartialcompleted: false }),
    };
    const rec = mapDeleted(S, copy, createReport());
    expect(rec).toMatchObject({
      surveyId: S.toLowerCase(),
      responseId: R.toLowerCase(),
      deletedAt: "2026-04-01T00:00:00.000Z",
    });
    expect(JSON.parse(rec!.response)).toEqual({
      data: { q: 1 },
      clientId: "c",
      partial: false,
      respondentIp: "1.2.3.4",
    });
    expect(Object.keys(JSON.parse(rec!.response))).toEqual([
      "data",
      "clientId",
      "partial",
      "respondentIp",
    ]);
  });

  it("skips a copy that is unreadable or has no GUID id", () => {
    const report = createReport();
    const bad = { responseId: R, deletedAt: new Date(0), entity: entity("zzz") };
    expect(mapDeleted(S, bad, report)).toBeNull();
    expect(mapDeleted(S, { ...bad, responseId: "x", entity: entity("{}") }, report)).toBeNull();
    expect(report.counts()).toEqual({ "skipped:deleted_response": 2 });
  });

  it("skips and reports a copy whose deletion time is not a date", () => {
    const report = createReport();
    const copy = { responseId: R, deletedAt: null, entity: entity("{}") };
    expect(mapDeleted(S, copy, report)).toBeNull();
    expect(report.toJSON()).toMatchObject({
      skipped: [{ entity: "deleted_response", reason: "the time is not a date" }],
    });
  });
});

describe("mapMarker", () => {
  it('is partial only for a Boolean true, and reports a flag that is no Boolean (the old reader took "1")', () => {
    const report = createReport();
    const marker = (ispartialcompleted: unknown) => ({ clientId: "Client-1", ispartialcompleted });
    expect(mapMarker(S, marker(true), report)).toEqual({
      surveyId: S.toLowerCase(),
      clientId: "Client-1",
      partial: true,
    });
    expect(mapMarker(S, marker(false), report).partial).toBe(false);
    expect(mapMarker(S, marker(undefined), report).partial).toBe(false);
    expect(report.counts()).toEqual({});
    expect(mapMarker(S, marker("1"), report).partial).toBe(false);
    expect(mapMarker(S, marker(1), report).partial).toBe(false);
    // By the survey only: a client id can be an email.
    expect(report.toJSON()).toMatchObject({
      notes: [
        { kind: "marker_partial_not_boolean", ids: { surveyId: S.toLowerCase() } },
        { kind: "marker_partial_not_boolean", ids: { surveyId: S.toLowerCase() } },
      ],
    });
  });
});

describe("mapHistory", () => {
  const entry = (n: number, at: string, userId: string | null = null) => ({
    entry: { id: `0a1b2c3d-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`, at, userId },
    text: `{"n":${n}}`,
  });

  it("keeps the 20 newest by time then id, whatever order they come in", () => {
    const items = Array.from({ length: 25 }, (_, n) =>
      entry(n, new Date(Date.UTC(2026, 0, 1, 0, 0, n % 5)).toISOString()),
    );
    const out = mapHistory(S, [...items].reverse(), createReport());
    expect(out).toHaveLength(20);
    const newerFirst = (a: (typeof items)[number], b: (typeof items)[number]) =>
      a.entry.at === b.entry.at
        ? a.entry.id < b.entry.id
          ? 1
          : -1
        : a.entry.at < b.entry.at
          ? 1
          : -1;
    const expected = [...items]
      .sort(newerFirst)
      .slice(0, 20)
      .map((i) => i.entry.id);
    expect(out.map((h) => h.id)).toEqual(expected);
  });

  it("maps a snapshot: lower-case survey id, author, BOM removed", () => {
    const item = { ...entry(1, "2026-01-01T00:00:00.000Z", "aa"), text: '﻿{"a":"x\\u0000"}' };
    const report = createReport();
    expect(mapHistory(S, [item], report)).toEqual([
      {
        surveyId: S.toLowerCase(),
        id: item.entry.id,
        at: "2026-01-01T00:00:00.000Z",
        userId: "aa",
        snapshot: { a: "x�" },
      },
    ]);
    expect(report.counts()).toEqual({ nul_replaced: 1 });
  });

  it("skips and reports a snapshot that is not a JSON object, and goes on", () => {
    const report = createReport();
    const out = mapHistory(
      S,
      [
        { ...entry(1, "2026-01-02T00:00:00.000Z"), text: "[1]" },
        entry(2, "2026-01-01T00:00:00.000Z"),
      ],
      report,
    );
    expect(out).toHaveLength(1);
    expect(report.counts()).toEqual({ "skipped:history_entry": 1 });
  });
});
