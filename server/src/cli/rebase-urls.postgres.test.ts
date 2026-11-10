import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type SqlDatabase } from "../sql/database.js";
import { migrate } from "../sql/migrator.js";
import { createSqlResultStore } from "../sql/result-store.js";
import { scratchPostgres, type ScratchDatabase } from "../sql/scratch-databases.js";
import { createSqlSurveyStore } from "../sql/survey-store.js";
import { rebaseFileUrls } from "./rebase-urls.js";

// The SQLite tests (rebase-urls.test.ts) cover the command; this checks the jsonb columns.
const OLD = "http://old.example:8080";
const NEW = "https://surveys.example.com";
const FILES = "/api/v1/public/files/";
const SURVEY = "aaaaaaaa-0000-4000-8000-000000000001";
const OWNER = "bbbbbbbb-0000-4000-8000-000000000001";
const AT = "2026-11-10T10:00:00.000Z";
const FILE = `${SURVEY}-0001`;

describe("rebase-urls on PostgreSQL", () => {
  let scratch: ScratchDatabase | null = null;
  let database: SqlDatabase | null = null;
  afterEach(async () => {
    await database?.close();
    await scratch?.drop();
    database = null;
    scratch = null;
  });

  it("rewrites the jsonb definition, theme, snapshot and response", async () => {
    scratch = await scratchPostgres();
    database = openDatabase(scratch.target);
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
    const first = await surveys.getDefinition(SURVEY);
    await surveys.saveDefinition(
      SURVEY,
      { logo: `${OLD}${FILES}${FILE}` },
      { ifVersion: first!.version, userId: OWNER, savedAt: AT },
    );
    const theme = await surveys.getTheme(SURVEY);
    await surveys.saveTheme(
      SURVEY,
      { backgroundImage: `${OLD}${FILES}${FILE}` },
      { ifVersion: theme!.version, savedAt: AT },
    );
    const results = createSqlResultStore(database);
    await results.appendResponse(record, {
      id: "cccccccc-0000-4000-8000-000000000001",
      submittedAt: AT,
      data: { upload: [{ content: `${OLD}${FILES}${FILE}` }] },
    });

    expect(await rebaseFileUrls(database, { from: OLD, to: NEW, write: true })).toEqual({
      definitions: 1,
      themes: 1,
      snapshots: 1,
      responses: 1,
    });

    const url = `${NEW}${FILES}${FILE}`;
    expect((await surveys.getDefinition(SURVEY))!.content).toEqual({ logo: url });
    expect((await surveys.getTheme(SURVEY))!.content).toEqual({ backgroundImage: url });
    const history = await surveys.listHistory({ surveyId: SURVEY, limit: 10 });
    expect(await surveys.getHistorySnapshot(SURVEY, history.items[0]!.id)).toEqual({ logo: url });
    const [response] = await results.listResponses(record);
    expect(response!.data).toEqual({ upload: [{ content: url }] });
  });
});
