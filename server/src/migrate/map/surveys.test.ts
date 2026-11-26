import { describe, expect, it } from "vitest";
import type { LegacySurveyRow } from "../../providers/azure-legacy/rows.js";
import { createReport, type Report } from "./report.js";
import { mapSurvey } from "./surveys.js";

const g = (n: number) => `0A1B2C3D-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const low = (n: number) => g(n).toLowerCase();
const SURVEY = 1;
const OWNER = 2;
const CREATOR = 3;
const PROJECT = 4;

type Row = LegacySurveyRow & { theme: string | null };
const row = (extra: Partial<Row> = {}): Row => ({
  id: g(SURVEY),
  name: "S",
  userid: g(OWNER),
  creatorid: g(CREATOR),
  postid: g(10),
  resultid: g(11),
  createdat: new Date("2020-01-01T00:00:00.000Z"),
  timestamp: new Date("2021-01-01T00:00:00.000Z"),
  ispublished: 1,
  isarchived: 0,
  allowaccessresult: 1,
  storeipaddress: "0",
  usecookies: 0,
  publishid: null,
  theme: null,
  ...extra,
});
const ctx = (
  report: Report,
  extra: Partial<{
    projects: string[];
    memberless: string[];
    people: string[];
    legacyUsers: string[];
  }> = {},
) => ({
  projects: new Set(extra.projects ?? []),
  projectsWithoutMembers: new Set(extra.memberless ?? []),
  people: new Set(extra.people ?? [low(OWNER), low(CREATOR)]),
  legacyUsers: new Set(extra.legacyUsers ?? [low(OWNER), low(CREATOR)]),
  report,
});

describe("mapSurvey, privacy", () => {
  const perms = JSON.stringify([
    { name: "p", isPublic: false },
    { name: "q", isPublic: true },
  ]);
  const definition = JSON.stringify({
    pages: [
      {
        elements: [
          { type: "text", name: "p" },
          { type: "text", name: "c" },
          { type: "text", name: "d" },
          { type: "text", name: "e", valueName: "ev", showCommentArea: true },
        ],
      },
    ],
  });
  const layout = (columns: object[], extra: object = {}) => JSON.stringify({ columns, ...extra });
  const shown = [
    { name: "HappendAt" },
    { name: "InstanceId" },
    { name: "p" },
    { name: "c" },
    { name: "d" },
    { name: "ev" },
    { name: "ev-Comment" },
  ];
  const privates = (p: string | null, c: string | null, def = definition) =>
    mapSurvey(row(), def, p, c, ctx(createReport()))?.privateQuestions.slice().sort();

  it("takes the permissions' non-public names only", () => {
    const rec = mapSurvey(row(), definition, perms, null, ctx(createReport()));
    expect(rec?.privateQuestions).toEqual(["p"]);
    expect(rec?.record.settings.publicResults).toBe(true);
  });

  it("takes the layout's hidden and non-public listed columns only", () => {
    const text = layout(shown.map((c) => (c.name === "c" ? { ...c, visibility: 2 } : c)));
    expect(privates(null, text)).toEqual(["c"]);
    const hidden = layout(shown.map((c) => (c.name === "d" ? { ...c, visibility: 1 } : c)));
    expect(privates(null, hidden)).toEqual(["d"]);
  });

  it("with both, keeps public only the names the permissions mark public and the layout lists", () => {
    // c is listed hidden, yet public by the permissions; q is public there but not listed.
    const marked = JSON.stringify([
      { name: "p", isPublic: false },
      { name: "c", isPublic: true },
      { name: "d", isPublic: true },
      { name: "q", isPublic: true },
    ]);
    const text = layout(shown.map((c) => (c.name === "c" ? { ...c, visibility: 1 } : c)));
    expect(privates(marked, text)).toEqual(
      ["HappendAt", "InstanceId", "ev", "ev-Comment", "p", "q"].sort(),
    );
  });

  it("with both, hides an answer added after the permissions were saved, HappendAt and a response-only name", () => {
    // The old public results: q2 came after the permissions list; k is only in responses.
    const def = JSON.stringify({
      pages: [{ elements: ["q1", "q2"].map((name) => ({ type: "text", name })) }],
    });
    const marked = JSON.stringify([{ name: "q1", isPublic: true }]);
    const text = layout([{ name: "HappendAt" }, { name: "q1" }, { name: "q2" }], {
      newcolumnsvisibility: 0,
    });
    const report = createReport();
    const rec = mapSurvey(row(), def, marked, text, { ...ctx(report), extraAnswerNames: ["k"] });
    expect(rec?.record.settings.publicResults).toBe(true);
    expect(rec?.privateQuestions.slice().sort()).toEqual(["HappendAt", "InstanceId", "k", "q2"]);
    expect(report.counts()).toEqual({});
  });

  it("with both, a list of private entries only (as Studio wrote it) leaves no public answer, reported", () => {
    const report = createReport();
    const rec = mapSurvey(
      row(),
      definition,
      JSON.stringify([{ name: "p", isPublic: false }]),
      layout(shown),
      ctx(report),
    );
    expect(rec?.record.settings.publicResults).toBe(true);
    expect(rec?.privateQuestions.slice().sort()).toEqual(
      ["HappendAt", "InstanceId", "c", "d", "ev", "ev-Comment", "p"].sort(),
    );
    expect(report.counts()).toEqual({ public_results_no_public_answer: 1 });
    expect(report.toJSON()).toMatchObject({ notes: [{ ids: { surveyId: low(SURVEY) } }] });
    // Public results off: nothing to tell.
    const off = createReport();
    mapSurvey(row({ allowaccessresult: 0 }), definition, "[]", layout(shown), ctx(off));
    expect(off.counts()).toEqual({});
    // Only the submit time public: still no public answer.
    const timeOnly = createReport();
    const onlyTime = JSON.stringify([{ name: "HappendAt", isPublic: true }]);
    mapSurvey(row(), definition, onlyTime, layout(shown), ctx(timeOnly));
    expect(timeOnly.counts()).toEqual({ public_results_no_public_answer: 1 });
  });

  it("has none when neither marks any, or the layout lists no columns", () => {
    expect(privates(null, null)).toEqual([]);
    expect(privates(null, "")).toEqual([]);
    expect(privates(null, "  ")).toEqual([]);
    expect(privates(null, layout([], { newcolumnsvisibility: 2 }))).toEqual([]);
    expect(privates(null, layout(shown))).toEqual([]);
  });

  it("gives answers the layout does not list its new-columns visibility, comment and value names included", () => {
    const text = layout([{ name: "c" }, { name: "HappendAt" }, { name: "InstanceId" }], {
      newcolumnsvisibility: 2,
    });
    expect(privates(null, text)).toEqual(["d", "ev", "ev-Comment", "p"]);
    const open = layout([{ name: "c" }, { name: "HappendAt" }, { name: "InstanceId" }], {
      newcolumnsvisibility: 0,
    });
    expect(privates(null, open)).toEqual([]);
  });

  it("hides HappendAt and InstanceId when the layout hides or omits them", () => {
    expect(privates(null, layout([{ name: "c" }, { name: "HappendAt", visibility: 2 }]))).toEqual([
      "HappendAt",
      "InstanceId",
    ]);
  });

  it("counts the extra answer names (response keys) the copy passes", () => {
    const text = layout([{ name: "c" }, { name: "HappendAt" }, { name: "InstanceId" }], {
      newcolumnsvisibility: 1,
    });
    const rec = mapSurvey(row(), "{}", null, text, {
      ...ctx(createReport()),
      extraAnswerNames: ["k1"],
    });
    expect(rec?.privateQuestions).toEqual(["k1"]);
  });

  it.each([
    ["permissions", "nope", null],
    ["column layout", null, "nope"],
    ["new-columns visibility", null, JSON.stringify({ newcolumnsvisibility: true })],
  ])("turns public results off and reports when the %s is unreadable", (_name, p, c) => {
    const report = createReport();
    const rec = mapSurvey(row(), "{}", p, c, ctx(report));
    expect(rec?.record.settings.publicResults).toBe(false);
    expect(report.counts()).toEqual({ public_results_off_unreadable_setting: 1 });
    expect(report.toJSON()).toMatchObject({ notes: [{ ids: { surveyId: low(SURVEY) } }] });
  });
});

describe("mapSurvey, ownership", () => {
  it("keeps a project survey in its project, and a personal one with its person", () => {
    const inProject = mapSurvey(
      row({ userid: g(PROJECT) }),
      "{}",
      null,
      null,
      ctx(createReport(), { projects: [low(PROJECT)] }),
    );
    expect(inProject?.record.owner).toEqual({ kind: "project", projectId: low(PROJECT) });
    const personal = mapSurvey(row(), "{}", null, null, ctx(createReport()));
    expect(personal?.record.owner).toEqual({ kind: "personal", userId: low(OWNER) });
  });

  it("keeps a survey of a person with no profile personal, with that owner", () => {
    const report = createReport();
    const rec = mapSurvey(row(), "{}", null, null, ctx(report, { people: [] }));
    expect(rec?.record.owner).toEqual({ kind: "personal", userId: low(OWNER) });
    expect(report.counts()).toEqual({});
  });

  it.each([
    ["missing", {}],
    ["member-less", { memberless: [low(PROJECT)] }],
  ])("moves a survey of a %s project to its creator, keeping archived", (_n, extra) => {
    const report = createReport();
    const rec = mapSurvey(
      row({ userid: g(PROJECT), isarchived: 1 }),
      "{}",
      null,
      null,
      ctx(report, extra),
    );
    expect(rec?.record.owner).toEqual({ kind: "personal", userId: low(CREATOR) });
    expect(rec?.record.archived).toBe(true);
    expect(Object.keys(report.counts())).toHaveLength(1);
  });

  it.each([
    ["no creator", { creatorid: null }, undefined],
    ["the zero creator", { creatorid: "00000000-0000-0000-0000-000000000000" }, undefined],
    ["an unknown creator", { creatorid: g(77) }, undefined],
    ["a creator without a profile", {}, { people: [] as string[] }],
  ])(
    "keeps a survey naming the project as is when there is %s, and reports it",
    (_n, over, extra) => {
      const report = createReport();
      const rec = mapSurvey(
        row({ userid: g(PROJECT), ...over }),
        "{}",
        null,
        null,
        ctx(report, extra),
      );
      expect(rec?.record.owner).toEqual({ kind: "project", projectId: low(PROJECT) });
      expect(report.counts()).toEqual({ survey_kept_in_missing_project: 1 });
    },
  );
});

describe("mapSurvey, text", () => {
  it("strips a BOM from the theme, replaces NUL, and reads a bad theme as empty (reported)", () => {
    const report = createReport();
    const rec = mapSurvey(
      row({ theme: '﻿{"a":"x\\u0000"}' }),
      '﻿{"title":"t\\u0000"}',
      null,
      null,
      ctx(report),
    );
    expect(rec?.theme).toEqual({ a: "x�" });
    expect(rec?.definition).toEqual({ title: "t�" });
    expect(report.counts()).toEqual({ nul_replaced: 2 });
    const bad = createReport();
    expect(mapSurvey(row({ theme: "zzz" }), "{}", null, null, ctx(bad))?.theme).toEqual({});
    expect(bad.counts()).toEqual({ theme_unreadable: 1 });
  });

  it("reads a missing definition as empty and an unreadable one as empty, reported", () => {
    const report = createReport();
    expect(mapSurvey(row(), null, null, null, ctx(report))?.definition).toEqual({});
    expect(mapSurvey(row(), "[1]", null, null, ctx(report))?.definition).toEqual({});
    expect(report.counts()).toEqual({ definition_unreadable: 1 });
  });

  it("skips and reports a row whose ids are not GUIDs or are missing, without crashing", () => {
    const report = createReport();
    expect(mapSurvey(row({ id: "zzz" }), "{}", null, null, ctx(report))).toBeNull();
    expect(mapSurvey(row({ postid: "zzz" }), "{}", null, null, ctx(report))).toBeNull();
    expect(mapSurvey(row({ userid: null }), "{}", null, null, ctx(report))).toBeNull();
    expect(report.counts()).toEqual({ "skipped:survey": 3 });
  });

  it("maps the record with lower-case ids and exact times", () => {
    const rec = mapSurvey(row(), "{}", null, null, ctx(createReport()));
    expect(rec?.record).toMatchObject({
      id: low(SURVEY),
      creatorId: low(CREATOR),
      postId: low(10),
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2021-01-01T00:00:00.000Z",
    });
  });
});
