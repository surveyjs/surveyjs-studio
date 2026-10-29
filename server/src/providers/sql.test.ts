import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { openDatabase } from "../sql/database.js";
import { DatabaseTooNewError, migrationStatus } from "../sql/migrator.js";
import { scratchSqlite, type ScratchDatabase } from "../sql/scratch-databases.js";
import { OWNER_ID, surveyFeedback } from "./suite/expected.js";
import { createProviders } from "./index.js";
import { PendingMigrationsError } from "./sql.js";

describe("createProviders with STORAGE_PROVIDER=sqlite", () => {
  const scratches: ScratchDatabase[] = [];
  afterEach(async () => {
    for (const scratch of scratches.splice(0)) await scratch.drop();
  });
  const configFor = (extra: Record<string, string> = {}) => {
    const scratch = scratchSqlite();
    scratches.push(scratch);
    if (scratch.target.dialect !== "sqlite") throw new Error("unreachable");
    const config = loadConfig({
      IDENTITY_PROVIDER: "dev",
      STORAGE_PROVIDER: "sqlite",
      SQLITE_PATH: scratch.target.path,
      FILES_PATH: join(dirname(scratch.target.path), "files"),
      ...extra,
    });
    return { config, path: scratch.target.path };
  };
  const newSurvey = {
    id: "dddddddd-0000-4000-8000-000000000001",
    name: "Kept",
    owner: { kind: "personal", userId: OWNER_ID },
    creatorId: OWNER_ID,
    postId: "dddddddd-0000-4000-8000-000000000002",
    resultId: "dddddddd-0000-4000-8000-000000000003",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
  } as const;

  it("migrates a new database at start, and keeps surveys across restarts", async () => {
    const { config, path } = configFor();
    const first = await createProviders(config);
    expect(first.name).toBe("sqlite");
    await first.surveys.createSurvey(newSurvey, { title: "Kept" });
    await first.close();

    const database = openDatabase({ dialect: "sqlite", path });
    expect((await migrationStatus(database)).pending).toEqual([]);
    await database.close();

    const second = await createProviders(config);
    expect((await second.surveys.getDefinition(newSurvey.id))?.content).toEqual({ title: "Kept" });
    expect(await second.ready()).toEqual([
      { name: "database", ok: true },
      { name: "files", ok: true },
    ]);
    await second.close();
  });

  it("keeps responses, saved layouts, private questions and projects across restarts", async () => {
    const { config } = configFor();
    const first = await createProviders(config);
    const survey = await first.surveys.createSurvey(newSurvey);
    const response = {
      id: "dddddddd-0000-4000-8000-000000000004",
      submittedAt: "2026-10-01T11:00:00.000Z",
      data: { q1: "kept" },
      clientId: "browser-1",
    };
    await first.results.appendResponse(survey, response);
    await first.views.saveView(survey.id, OWNER_ID, "summary", { hidden: ["q1"] });
    await first.views.savePrivateQuestions(survey.id, ["q1"]);
    const project = "dddddddd-0000-4000-8000-000000000005";
    await first.projects.createProject({
      id: project,
      name: "Kept",
      creatorId: OWNER_ID,
      createdAt: "2026-10-01T10:00:00.000Z",
    });
    await first.close();

    const second = await createProviders(config);
    expect(await second.results.listResponses(survey)).toEqual([{ ...response, partial: false }]);
    expect(await second.results.completion(survey, "browser-1")).toBe("completed");
    expect(await second.views.getView(survey.id, OWNER_ID, "summary")).toEqual({ hidden: ["q1"] });
    expect(await second.views.getPrivateQuestions(survey.id)).toEqual(["q1"]);
    expect(await second.projects.getUserProject(OWNER_ID, project)).toMatchObject({
      project: { name: "Kept", ownerId: OWNER_ID, memberCount: 1 },
      role: "admin",
    });
    await second.close();
  });

  it("seeds the memory fallback with MEMORY_SEED, but not the database", async () => {
    const { config } = configFor({ MEMORY_SEED: "legacy-fixtures" });
    const providers = await createProviders(config);
    expect(await providers.users.getUser(OWNER_ID)).not.toBeNull();
    expect(await providers.surveys.getSurvey(surveyFeedback.id)).toBeNull();
    await providers.close();
  });

  it("refuses to start read-only on a database with pending migrations, and changes nothing", async () => {
    const { config, path } = configFor({ READ_ONLY: "true" });
    const error = await createProviders(config).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PendingMigrationsError);
    expect((error as Error).message).toBe(
      "READ_ONLY=true, but the database lacks migrations 0001-surveys, 0002-results-views-projects, 0003-files, 0004-local-accounts: run pnpm db:migrate (or start once without READ_ONLY) first.",
    );
    const database = openDatabase({ dialect: "sqlite", path });
    expect((await migrationStatus(database)).applied).toEqual([]);
    await database.close();
  });

  it("starts read-only on a migrated database", async () => {
    const { config: writable, path } = configFor();
    await (await createProviders(writable)).close();
    const readOnly = loadConfig({
      IDENTITY_PROVIDER: "dev",
      STORAGE_PROVIDER: "sqlite",
      SQLITE_PATH: path,
      FILES_PATH: join(dirname(path), "files"),
      READ_ONLY: "true",
    });
    const providers = await createProviders(readOnly);
    expect(await providers.surveys.listSurveys({ kind: "personal", userId: OWNER_ID })).toEqual([]);
    await providers.close();
  });

  it("refuses a database a newer version migrated", async () => {
    const { config, path } = configFor();
    await (await createProviders(config)).close();
    const database = openDatabase({ dialect: "sqlite", path });
    await database.db
      .insertInto("schema_migrations")
      .values({ version: 9999, name: "future", applied_at: new Date().toISOString() })
      .execute();
    await database.close();
    await expect(createProviders(config)).rejects.toThrow(DatabaseTooNewError);
  });
});
