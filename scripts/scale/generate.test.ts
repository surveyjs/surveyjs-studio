import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type SqlDatabase } from "../../server/src/sql/database.js";
import { migrate, migrationStatus } from "../../server/src/sql/migrator.js";
import { scratchSqlite, type ScratchDatabase } from "../../server/src/sql/scratch-databases.js";
import { generate, run, SURVEY_BATCH } from "./generate.js";
import { parseSizes, type ScaleSizes } from "./sizes.js";

const sizes: ScaleSizes = {
  users: 3,
  surveys: 5,
  responses: 20,
  largest: 50,
  historyPerSurvey: 20,
  seed: 1,
};

const opened: { database: SqlDatabase; scratch: ScratchDatabase }[] = [];
async function fresh() {
  const scratch = scratchSqlite();
  const database = openDatabase(scratch.target);
  await migrate(database);
  opened.push({ database, scratch });
  return database;
}
afterEach(async () => {
  for (const { database, scratch } of opened.splice(0)) {
    await database.close();
    await scratch.drop();
  }
});

const count = async (
  database: SqlDatabase,
  table: "users" | "surveys" | "survey_history" | "survey_responses",
) =>
  Number(
    (
      await database.db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll().as("n"))
        .executeTakeFirstOrThrow()
    ).n,
  );

describe("generate", () => {
  it("writes the sizes it is given", async () => {
    const database = await fresh();
    const { largestSurveyId, ownerId } = await generate(database, sizes);
    expect(await count(database, "users")).toBe(sizes.users);
    expect(await count(database, "surveys")).toBe(sizes.surveys);
    expect(await count(database, "survey_responses")).toBe(sizes.responses + sizes.largest);
    const largest = await database.db
      .selectFrom("survey_responses")
      .where("survey_id", "=", largestSurveyId)
      .select((eb) => eb.fn.countAll().as("n"))
      .executeTakeFirstOrThrow();
    expect(Number(largest.n)).toBe(sizes.largest);
    const owner = await database.db
      .selectFrom("surveys")
      .select("owner_user_id")
      .where("id", "=", largestSurveyId)
      .executeTakeFirstOrThrow();
    expect(owner.owner_user_id).toBe(ownerId);
  });

  it("keeps at most the history it is given per survey", async () => {
    const database = await fresh();
    await generate(database, sizes);
    const rows = await database.db
      .selectFrom("survey_history")
      .select(["survey_id", (eb) => eb.fn.countAll().as("n")])
      .groupBy("survey_id")
      .execute();
    expect(rows).toHaveLength(sizes.surveys);
    for (const row of rows) expect(Number(row.n)).toBeLessThanOrEqual(sizes.historyPerSurvey);
    expect(await count(database, "survey_history")).toBe(sizes.surveys * sizes.historyPerSurvey);
  });

  it("gives the same ids for the same seed, and others for another", async () => {
    const ids = async (seed: number) => {
      const database = await fresh();
      const { largestSurveyId } = await generate(database, { ...sizes, seed });
      const rows = await database.db
        .selectFrom("survey_responses")
        .select("id")
        .orderBy("id")
        .execute();
      return { largestSurveyId, responses: rows.map((r) => r.id) };
    };
    const a = await ids(1);
    expect(await ids(1)).toEqual(a);
    expect(await ids(2)).not.toEqual(a);
  });

  it("reports its progress without ids", async () => {
    const database = await fresh();
    const lines: string[] = [];
    await generate(database, sizes, (line) => lines.push(line));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});

describe("parseSizes", () => {
  it("reads the flags and defaults history to 20 and seed to 1", () => {
    expect(
      parseSizes(["--users", "3", "--surveys", "5", "--responses", "20", "--largest", "50"]),
    ).toEqual({
      sizes: { ...sizes },
    });
  });
  it("names a bad flag", () => {
    expect(parseSizes(["--users", "x"])).toHaveProperty("error");
    expect(parseSizes(["--users", "0"])).toHaveProperty("error");
    expect(parseSizes(["--nope"])).toHaveProperty("error");
  });
});

describe("batches", () => {
  it("writes the sizes across the survey and response batch boundaries", async () => {
    const database = await fresh();
    const big: ScaleSizes = {
      users: 4,
      surveys: SURVEY_BATCH + 7,
      responses: 100,
      largest: 2500,
      historyPerSurvey: 2,
      seed: 3,
    };
    await generate(database, big);
    expect(await count(database, "surveys")).toBe(big.surveys);
    expect(await count(database, "survey_history")).toBe(big.surveys * big.historyPerSurvey);
    expect(await count(database, "survey_responses")).toBe(big.responses + big.largest);
  });
});

describe("run", () => {
  const args = ["--users", "2", "--surveys", "3", "--responses", "5", "--largest", "5"];

  it("needs the database named", async () => {
    const result = await run(args, {});
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/^Error: /);
  });

  it("refuses a database that holds a survey, writing nothing", async () => {
    const database = await fresh();
    await generate(database, { ...sizes, users: 1, surveys: 1, responses: 0, largest: 0 });
    const path = opened.at(-1)!.scratch.target;
    if (path.dialect !== "sqlite") throw new Error("sqlite expected");
    await database.db.deleteFrom("users").execute();
    const before = await count(database, "surveys");
    const result = await run(args, { SQLITE_PATH: path.path });
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/^Error: .*surveys/);
    expect(await count(database, "surveys")).toBe(before);
    expect(await count(database, "users")).toBe(0);
  });

  it("refuses a database that holds a user, writing nothing", async () => {
    const database = await fresh();
    await generate(database, { ...sizes, users: 1, surveys: 1, responses: 0, largest: 0 });
    await database.db.deleteFrom("surveys").execute();
    const path = opened.at(-1)!.scratch.target;
    if (path.dialect !== "sqlite") throw new Error("sqlite expected");
    const result = await run(args, { SQLITE_PATH: path.path });
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/^Error: .*users/);
    expect(await count(database, "surveys")).toBe(0);
    expect(await count(database, "users")).toBe(1);
  });

  it("refuses a database with data before migrating it, leaving its schema as it was", async () => {
    const database = await fresh();
    await generate(database, { ...sizes, users: 1, surveys: 1, responses: 0, largest: 0 });
    // An older database: the newest migration is not recorded as applied.
    const { applied } = await migrationStatus(database);
    await database.db
      .deleteFrom("schema_migrations")
      .where("version", "=", applied.at(-1)!.version)
      .execute();
    const target = opened.at(-1)!.scratch.target;
    if (target.dialect !== "sqlite") throw new Error("sqlite expected");
    expect((await migrationStatus(database)).pending).toHaveLength(1);
    const result = await run(args, { SQLITE_PATH: target.path });
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/^Error: .*already holds data/);
    expect((await migrationStatus(database)).pending).toHaveLength(1);
  });

  it("fills an empty database and prints its token line", async () => {
    const scratch = scratchSqlite();
    opened.push({ database: openDatabase(scratch.target), scratch });
    if (scratch.target.dialect !== "sqlite") throw new Error("sqlite expected");
    const lines: string[] = [];
    const result = await run(args, { SQLITE_PATH: scratch.target.path }, (l) => lines.push(l));
    expect(result.code).toBe(0);
    expect(lines.at(-1)).toMatch(/^--survey \S+ --token sjs_/);
  });
});
