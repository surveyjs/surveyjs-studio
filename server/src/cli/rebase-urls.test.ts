import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type SqlDatabase } from "../sql/database.js";
import { migrate } from "../sql/migrator.js";
import { createSqlResultStore } from "../sql/result-store.js";
import { scratchSqlite, type ScratchDatabase } from "../sql/scratch-databases.js";
import { createSqlSurveyStore } from "../sql/survey-store.js";
import { rebaseFileUrls, run } from "./rebase-urls.js";

function capture() {
  let out = "";
  let err = "";
  return {
    io: { out: (text: string) => (out += text), err: (text: string) => (err += text) },
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

const OLD = "http://old.example:8080";
const NEW = "https://surveys.example.com";
const FILES = "/api/v1/public/files/";
const SURVEY = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "aaaaaaaa-0000-4000-8000-000000000002";
const OWNER = "bbbbbbbb-0000-4000-8000-000000000001";
const RESPONSE = "cccccccc-0000-4000-8000-000000000001";
const FILE_A = `${SURVEY}-0001`;
const FILE_B = `${SURVEY}-0002`;
const AT = "2026-11-10T10:00:00.000Z";

const definitionWith = (base: string) => ({
  pages: [
    {
      elements: [
        { type: "image", name: "logo", imageLink: `${base}${FILES}${FILE_A}` },
        {
          type: "html",
          name: "intro",
          html: `<p><img src="${base}${FILES}${FILE_A}"> and <img src="${base}${FILES}${FILE_B}"></p>`,
        },
        // Not a stored file: another path on the same origin, and another host.
        { type: "html", name: "links", html: `<a href="${base}/s/x">run</a>` },
        {
          type: "image",
          name: "elsewhere",
          imageLink: `${base}.org${FILES}${FILE_A}`,
        },
      ],
    },
  ],
});

describe("rebase-urls", () => {
  const scratches: ScratchDatabase[] = [];
  const open: SqlDatabase[] = [];
  afterEach(async () => {
    for (const database of open.splice(0)) await database.close();
    for (const scratch of scratches.splice(0)) await scratch.drop();
  });

  async function seeded() {
    const scratch = scratchSqlite();
    scratches.push(scratch);
    if (scratch.target.dialect !== "sqlite") throw new Error("unreachable");
    const database = openDatabase(scratch.target);
    open.push(database);
    await migrate(database);
    const surveys = createSqlSurveyStore(database);
    const record = await surveys.createSurvey({
      id: SURVEY,
      name: "With files",
      owner: { kind: "personal", userId: OWNER },
      creatorId: OWNER,
      postId: "dddddddd-0000-4000-8000-000000000001",
      resultId: "dddddddd-0000-4000-8000-000000000002",
      createdAt: AT,
      updatedAt: AT,
    });
    await surveys.createSurvey({
      id: OTHER,
      name: "No files",
      owner: { kind: "personal", userId: OWNER },
      creatorId: OWNER,
      postId: "dddddddd-0000-4000-8000-000000000003",
      resultId: "dddddddd-0000-4000-8000-000000000004",
      createdAt: AT,
      updatedAt: AT,
    });
    const first = await surveys.getDefinition(SURVEY);
    const saved = await surveys.saveDefinition(SURVEY, definitionWith(OLD), {
      ifVersion: first!.version,
      userId: OWNER,
      savedAt: AT,
    });
    if (saved.kind !== "saved") throw new Error(`save: ${saved.kind}`);
    const theme = await surveys.getTheme(SURVEY);
    await surveys.saveTheme(
      SURVEY,
      { backgroundImage: `${OLD}${FILES}${FILE_B}` },
      { ifVersion: theme!.version, savedAt: AT },
    );
    const results = createSqlResultStore(database);
    await results.appendResponse(record, {
      id: RESPONSE,
      submittedAt: AT,
      data: {
        upload: [{ name: "cv.pdf", type: "application/pdf", content: `${OLD}${FILES}${FILE_A}` }],
        comment: "unchanged",
      },
    });
    return { scratch, database, surveys, results, record, definitionVersion: saved.version };
  }

  it("rewrites file URLs in definitions, themes, history and responses, and nothing else", async () => {
    const { database, surveys, results, record, definitionVersion } = await seeded();

    const report = await rebaseFileUrls(database, { from: OLD, to: NEW, write: true });
    expect(report).toEqual({ definitions: 1, themes: 1, snapshots: 1, responses: 1 });

    const definition = await surveys.getDefinition(SURVEY);
    expect(definition!.content).toEqual(
      JSON.parse(
        JSON.stringify(definitionWith(NEW))
          // The two values that are not stored files stay as they were.
          .replace(`${NEW}/s/x`, `${OLD}/s/x`)
          .replace(`${NEW}.org${FILES}`, `${OLD}.org${FILES}`),
      ),
    );
    expect((await surveys.getTheme(SURVEY))!.content).toEqual({
      backgroundImage: `${NEW}${FILES}${FILE_B}`,
    });
    const history = await surveys.listHistory({ surveyId: SURVEY, limit: 10 });
    const snapshot = await surveys.getHistorySnapshot(SURVEY, history.items[0]!.id);
    expect(snapshot).toEqual(definition!.content);
    const [response] = await results.listResponses(record);
    expect(response!.data).toEqual({
      upload: [{ name: "cv.pdf", type: "application/pdf", content: `${NEW}${FILES}${FILE_A}` }],
      comment: "unchanged",
    });

    // An editor still holding the old version gets a conflict instead of writing the old URLs back.
    expect(definition!.version).not.toBe(definitionVersion);
    const stale = await surveys.saveDefinition(SURVEY, definitionWith(OLD), {
      ifVersion: definitionVersion,
      userId: OWNER,
      savedAt: AT,
    });
    expect(stale.kind).toBe("conflict");
  });

  it("counts without writing on a dry run", async () => {
    const { database, surveys, definitionVersion } = await seeded();
    const report = await rebaseFileUrls(database, { from: OLD, to: NEW, write: false });
    expect(report).toEqual({ definitions: 1, themes: 1, snapshots: 1, responses: 1 });
    const definition = await surveys.getDefinition(SURVEY);
    expect(definition!.version).toBe(definitionVersion);
    expect(JSON.stringify(definition!.content)).not.toContain(NEW);
  });

  it("reads every page", async () => {
    const { database, results, record } = await seeded();
    await results.appendResponse(record, {
      id: "cccccccc-0000-4000-8000-000000000002",
      submittedAt: AT,
      data: { again: `${OLD}${FILES}${FILE_B}` },
    });
    const report = await rebaseFileUrls(database, { from: OLD, to: NEW, write: true, pageSize: 1 });
    expect(report).toEqual({ definitions: 1, themes: 1, snapshots: 1, responses: 2 });
    expect(
      await rebaseFileUrls(database, { from: OLD, to: NEW, write: false, pageSize: 1 }),
    ).toEqual({ definitions: 0, themes: 0, snapshots: 0, responses: 0 });
  });

  it("finds nothing the second time", async () => {
    const { database } = await seeded();
    await rebaseFileUrls(database, { from: OLD, to: NEW, write: true });
    expect(await rebaseFileUrls(database, { from: OLD, to: NEW, write: true })).toEqual({
      definitions: 0,
      themes: 0,
      snapshots: 0,
      responses: 0,
    });
  });

  describe("the command", () => {
    async function env(extra: Record<string, string> = {}) {
      const { scratch, database } = await seeded();
      await database.close();
      open.splice(open.indexOf(database), 1);
      if (scratch.target.dialect !== "sqlite") throw new Error("unreachable");
      return {
        STORAGE_PROVIDER: "sqlite",
        SQLITE_PATH: scratch.target.path,
        ...extra,
      };
    }

    it("is a dry run without --yes", async () => {
      const result = capture();
      expect(await run(["--from", OLD, "--to", `${NEW}/`], result.io, { env: await env() })).toBe(
        0,
      );
      expect(result.out).toContain(`Replacing ${OLD}${FILES} with ${NEW}${FILES}`);
      expect(result.out).toContain("1 definition, 1 theme, 1 history snapshot, 1 response");
      expect(result.out).toContain("Dry run: nothing was written. Run again with --yes to write.");
    });

    it("writes with --yes", async () => {
      const settings = await env();
      const first = capture();
      expect(await run(["--from", OLD, "--to", NEW, "--yes"], first.io, { env: settings })).toBe(0);
      expect(first.out).toContain("Rewrote 1 definition, 1 theme, 1 history snapshot, 1 response.");
      const again = capture();
      expect(await run(["--from", OLD, "--to", NEW], again.io, { env: settings })).toBe(0);
      expect(again.out).toContain("0 definitions, 0 themes, 0 history snapshots, 0 responses");
    });

    it.each([
      [[], "--from and --to are both needed"],
      [["--from", OLD], "--from and --to are both needed"],
      [["--from", "ftp://old.example", "--to", NEW], "--from must be an http or https URL"],
      [["--from", OLD, "--to", `${NEW}?a=1`], "--to must be an http or https URL"],
      [["--from", OLD, "--to", `${OLD}/`], "--from and --to are the same"],
      [["--from", OLD, "--to", NEW, "--force"], "Unknown argument: --force"],
    ])("refuses %j", async (argv, message) => {
      const result = capture();
      expect(await run(argv, result.io, { env: { STORAGE_PROVIDER: "sqlite" } })).toBe(2);
      expect(result.err).toContain(message);
    });

    it("refuses a provider without a database", async () => {
      const result = capture();
      expect(
        await run(["--from", OLD, "--to", NEW], result.io, {
          env: { STORAGE_PROVIDER: "azure-legacy" },
        }),
      ).toBe(2);
      expect(result.err).toContain("STORAGE_PROVIDER must be sqlite or postgres");
    });

    it("refuses to write with READ_ONLY=true", async () => {
      const result = capture();
      expect(
        await run(["--from", OLD, "--to", NEW, "--yes"], result.io, {
          env: await env({ READ_ONLY: "true" }),
        }),
      ).toBe(2);
      expect(result.err).toContain("Refused: READ_ONLY=true. Nothing was written.");
    });
  });
});
