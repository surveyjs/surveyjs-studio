import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { legacyFeedbackSummaryView, legacyFeedbackTableView } from "../suite/expected.js";
import { legacyFixtureSeed, readLegacyFixtures } from "./fixtures.js";

const fixtureDir = fileURLToPath(new URL("../../../fixtures/legacy/", import.meta.url));
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SQL_GUID_COLUMNS = [
  "id",
  "userid",
  "creatorid",
  "postid",
  "resultid",
  "publishid",
  "organizationid",
  "parentlicenseid",
  "licenseid",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const jsonFiles = walk(fixtureDir).filter((path) => path.endsWith(".json"));

describe("fixture files", () => {
  it("has JSON files to check", () => {
    expect(jsonFiles.length).toBeGreaterThan(5);
  });

  it.each(jsonFiles.map((path) => [path.slice(fixtureDir.length).replaceAll("\\", "/"), path]))(
    "%s parses as a JSON array",
    (_name, path) => {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      expect(Array.isArray(parsed)).toBe(true);
    },
  );

  it("keeps every SQL GUID column a valid lower-case GUID (or null)", async () => {
    const { rawSqlRows } = await readLegacyFixtures();
    for (const [table, rows] of Object.entries(rawSqlRows)) {
      for (const row of rows) {
        for (const column of SQL_GUID_COLUMNS) {
          const value = row[column];
          if (value === undefined || value === null) continue;
          expect(value, `${table}.${column}`).toMatch(GUID);
        }
      }
    }
  });

  it("keeps every Edm.Guid table value a valid lower-case GUID", async () => {
    const { tables } = await readLegacyFixtures();
    let checked = 0;
    for (const table of tables) {
      for (const entity of table.entities) {
        for (const [key, type] of Object.entries(entity)) {
          if (!key.endsWith("@odata.type") || type !== "Edm.Guid") continue;
          const name = key.slice(0, -"@odata.type".length);
          expect(entity[name], `${table.name}.${name}`).toMatch(GUID);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe("readLegacyFixtures", () => {
  it("reads every SQL table into typed rows with Date columns", async () => {
    const fixtures = await readLegacyFixtures();
    expect(fixtures.surveys).toHaveLength(8);
    expect(fixtures.users).toHaveLength(6);
    expect(fixtures.organizations).toHaveLength(2);
    expect(fixtures.organizationUsers).toHaveLength(5);
    const old = fixtures.surveys.find((s) => s.name === "Old poll");
    expect(old?.createdat).toEqual(new Date("2025-12-10T12:00:00Z"));
    expect(old?.timestamp).toEqual(new Date("2026-05-20T12:00:00.123Z"));
    expect(old?.ispublished).toBe(0);
    expect(old?.storeipaddress).toBe("0");
  });

  it("reads happendat of projects and memberships as Dates", async () => {
    const { organizations, organizationUsers } = await readLegacyFixtures();
    const engineering = organizations.find((o) => o.name === "Engineering");
    expect(engineering?.happendat).toEqual(new Date("2025-12-05T09:30:00Z"));
    const creatorRow = organizationUsers.find((m) => m.id === engineering?.id);
    expect(creatorRow?.happendat).toEqual(new Date("2025-12-01T09:00:00Z"));
  });

  it("keeps NULL columns as null", async () => {
    const { surveys, users } = await readLegacyFixtures();
    const draft = surveys.find((s) => s.name === "Draft idea");
    expect(draft?.ispublished).toBeNull();
    expect(draft?.usecookies).toBeNull();
    expect(users.find((u) => u.email === "blocked@example.com")?.displayname).toBeNull();
  });

  it("converts result entities: annotated Edm.DateTime becomes a Date, Edm.Guid stays a string", async () => {
    const { resultsByTable } = await readLegacyFixtures();
    const rows = resultsByTable["post33333333000040008000a00000000001"];
    expect(rows).toHaveLength(5);
    const first = rows?.find((r) => r.id === "66666666-0000-4000-8000-a00000000001");
    expect(first?.happendat).toEqual(new Date("2026-04-01T08:00:00.500Z"));
    expect(typeof first?.id).toBe("string");
    const partial = rows?.find((r) => r.id === "66666666-0000-4000-8000-a00000000002");
    expect(partial).toMatchObject({ clientid: "client-0001", ispartialcompleted: true });
    expect(rows?.find((r) => r.id === "66666666-0000-4000-8000-a00000000003")?.ipaddress).toBe(
      "203.0.113.7",
    );
  });

  it("keeps the raw annotated entities for the loader", async () => {
    const { tables } = await readLegacyFixtures();
    const names = tables.map((t) => `${t.account}/${t.name}`).sort();
    expect(names).toContain("surveys/surveys");
    expect(names).toContain("results/post33333333000040008000a00000000001");
    expect(names).toContain("results/postdelete33333333000040008000a00000000001");
    expect(names).toContain("results/SurveyCompletion22222222000040008000a00000000001");
    const audit = tables.find((t) => t.name === "surveys");
    expect(audit?.entities[0]).toMatchObject({
      "happendat@odata.type": "Edm.DateTime",
      happendat: "2026-03-13T09:12:00Z",
    });
  });

  it("reads blobs as bytes, with nested names kept", async () => {
    const { blobs } = await readLegacyFixtures();
    const history = blobs.filter((b) => b.container === "surveyjsonhistory");
    expect(history.map((b) => b.name).sort()).toEqual([
      "22222222-0000-4000-8000-a00000000001/88888888-0000-4000-8000-a00000000001",
      "22222222-0000-4000-8000-a00000000001/88888888-0000-4000-8000-a00000000002",
    ]);
    const json = blobs.find(
      (b) => b.container === "surveyjson" && b.name === "22222222-0000-4000-8000-a00000000001",
    );
    const text = blobs.find(
      (b) => b.container === "surveytext" && b.name === "22222222-0000-4000-8000-a00000000001",
    );
    expect(json?.account).toBe("surveys");
    expect(Buffer.isBuffer(json?.content)).toBe(true);
    expect(json?.content.equals(text?.content ?? Buffer.alloc(0))).toBe(true);
    expect(JSON.parse(json?.content.toString("utf8") ?? "")).toHaveProperty("pages");
    expect(new Set(blobs.map((b) => b.container))).toEqual(
      new Set([
        "surveyjson",
        "surveytext",
        "surveyjsonhistory",
        "surveyresulttablestate",
        "surveyresultsummarystate",
        "surveyresultpermissions",
        "surveyresultcolumns",
      ]),
    );
  });

  it("has no definition blob for the never-saved survey", async () => {
    const { blobs } = await readLegacyFixtures();
    expect(blobs.some((b) => b.name === "22222222-0000-4000-8000-a00000000002")).toBe(false);
  });

  it("reads files as bytes", async () => {
    const { files } = await readLegacyFixtures();
    expect(files.map((f) => `${f.account}/${f.share}/${f.name}`).sort()).toEqual([
      "results/files/99999999-0000-4000-8000-a00000000002.png",
      "surveys/surveyfiles/99999999-0000-4000-8000-a00000000001",
    ]);
    const png = files.find((f) => f.name.endsWith(".png"));
    expect(png?.content.subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  it("reads another directory when asked", async () => {
    const { tmpdir } = await import("node:os");
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "legacy-fixtures-"));
    mkdirSync(join(dir, "sql"));
    writeFileSync(
      join(dir, "sql", "Users.json"),
      JSON.stringify([{ id: "11111111-0000-4000-8000-a00000000009", email: "x@example.com" }]),
    );
    const fixtures = await readLegacyFixtures(dir);
    expect(fixtures.users.map((u) => u.email)).toEqual(["x@example.com"]);
    expect(fixtures.surveys).toEqual([]);
    expect(fixtures.blobs).toEqual([]);
    // Only the generated table, which no directory can lack.
    expect(fixtures.tables.map((t) => t.name)).toEqual(["post33333333000040008000a00000000008"]);
  });
});

describe("legacyFixtureSeed", () => {
  it("classifies a survey owner as project when its userid is an organization id", async () => {
    const seed = await legacyFixtureSeed();
    const byName = (name: string) => seed.surveys.find((s) => s.name === name)?.owner;
    expect(byName("Campaign survey")).toEqual({
      kind: "project",
      projectId: "55555555-0000-4000-8000-a00000000001",
    });
    expect(byName("Customer feedback")).toEqual({
      kind: "personal",
      userId: "11111111-0000-4000-8000-a00000000001",
    });
  });

  it("holds one membership per legacy OrganizationUsers row", async () => {
    const seed = await legacyFixtureSeed();
    expect(seed.memberships).toHaveLength(5);
    expect(seed.projects).toHaveLength(2);
    expect(seed.users).toHaveLength(6);
    expect(seed.surveys).toHaveLength(8);
  });

  it("gives memberships lower-case ids and the role in lower case", async () => {
    const seed = await legacyFixtureSeed();
    expect(seed.memberships).toContainEqual({
      userId: "11111111-0000-4000-8000-a00000000002",
      projectId: "55555555-0000-4000-8000-a00000000001",
      role: "admin", // stored as "Admin"
    });
  });

  it("holds the parsed surveyjson blobs as definitions, by survey id", async () => {
    const seed = await legacyFixtureSeed();
    expect(Object.keys(seed.definitions ?? {}).sort()).toEqual([
      "22222222-0000-4000-8000-a00000000001",
      "22222222-0000-4000-8000-a00000000004",
      "22222222-0000-4000-8000-a00000000006",
      "22222222-0000-4000-8000-a00000000008",
    ]);
    expect(seed.definitions?.["22222222-0000-4000-8000-a00000000006"]).toMatchObject({
      title: "Engineering retro",
    });
  });

  it("holds the parsed theme column as themes, by survey id", async () => {
    const seed = await legacyFixtureSeed();
    expect(seed.themes).toEqual({
      "22222222-0000-4000-8000-a00000000001": {
        themeName: "default",
        colorPalette: "light",
        cssVariables: { "--sjs-primary-backcolor": "#19b394" },
      },
    });
  });

  it("holds the history points by survey id, timed at the survey update time, without a user", async () => {
    const seed = await legacyFixtureSeed();
    const feedback = seed.surveys.find((s) => s.name === "Customer feedback");
    expect(Object.keys(seed.history ?? {})).toEqual(["22222222-0000-4000-8000-a00000000001"]);
    const points = seed.history?.["22222222-0000-4000-8000-a00000000001"] ?? [];
    expect(points.map((p) => p.id).sort()).toEqual([
      "88888888-0000-4000-8000-a00000000001",
      "88888888-0000-4000-8000-a00000000002",
    ]);
    expect(points.every((p) => p.at === feedback?.updatedAt && p.userId === null)).toBe(true);
    expect(points.find((p) => p.id.endsWith("a00000000001"))?.snapshot).toMatchObject({
      title: "Customer feedback (draft)",
    });
  });
});

describe("the generated large survey", () => {
  const largeTable = "post33333333000040008000a00000000008";
  const largeSurvey = "22222222-0000-4000-8000-a00000000008";

  it("adds its 1,500 rows and table to the fixtures read from disk", async () => {
    const fixtures = await readLegacyFixtures();
    expect(fixtures.resultsByTable[largeTable]).toHaveLength(1500);
    expect(fixtures.tables.map((t) => `${t.account}/${t.name}`)).toContain(`results/${largeTable}`);
  });

  it("refuses a fixture file of the same table", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fixtures-"));
    try {
      cpSync(fixtureDir, dir, { recursive: true });
      mkdirSync(join(dir, "tables", "results"), { recursive: true });
      writeFileSync(join(dir, "tables", "results", `${largeTable}.json`), "[]");
      await expect(readLegacyFixtures(dir)).rejects.toThrow(
        `Fixture table ${largeTable} is generated by large-survey.ts; remove the file`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("gives the memory seed its responses", async () => {
    const seed = await legacyFixtureSeed();
    expect(seed.responses?.[largeSurvey]).toHaveLength(1500);
  });
});

describe("legacyFixtureSeed views", () => {
  it("holds the legacy layouts of the first survey, by survey id and view", async () => {
    const seed = await legacyFixtureSeed();
    expect(seed.legacyViews).toEqual({
      "22222222-0000-4000-8000-a00000000001": {
        summary: legacyFeedbackSummaryView,
        table: legacyFeedbackTableView,
      },
    });
  });
});

describe("legacyFixtureSeed private questions", () => {
  it("holds the private list of the first survey, by survey id", async () => {
    const seed = await legacyFixtureSeed();
    expect(seed.privateResultQuestions).toEqual({
      "22222222-0000-4000-8000-a00000000001": ["receipt"],
    });
  });
});
