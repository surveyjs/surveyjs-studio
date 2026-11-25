import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type SqlDatabase } from "../../server/src/sql/database.js";
import { migrate } from "../../server/src/sql/migrator.js";
import { scratchSqlite, type ScratchDatabase } from "../../server/src/sql/scratch-databases.js";
import { generate } from "./generate.js";
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
