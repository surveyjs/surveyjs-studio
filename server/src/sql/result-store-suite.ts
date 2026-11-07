import { randomUUID } from "node:crypto";
import { CompiledQuery, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase, type SqlDatabase, type SqlDialectName } from "./database.js";
import { migrate } from "./migrator.js";
import { createSqlResultStore, responsePageQuery } from "./result-store.js";
import { scratchDatabase, type ScratchDatabase } from "./scratch-databases.js";
import { createSqlSurveyStore } from "./survey-store.js";
import { createSqlViewStore } from "./view-store.js";

const SURVEY = "dddddddd-0000-4000-8000-0000000000a1";
const AFTER = {
  submittedAt: "2026-10-01T10:00:00.000Z",
  id: "dddddddd-0000-4000-8000-0000000000b1",
};

/** What the SQL result store must do beyond the provider suite: odd text, and its query plans. */
export function describeSqlResultStoreSuite(dialect: SqlDialectName): void {
  describe(`SQL result store: ${dialect}`, () => {
    let scratch: ScratchDatabase;
    let database: SqlDatabase;
    beforeAll(async () => {
      scratch = await scratchDatabase(dialect);
      database = openDatabase(scratch.target);
      await migrate(database);
    });
    afterAll(async () => {
      await database.close();
      await scratch.drop();
    });

    // jsonb holds neither U+0000 nor a lone surrogate (a client that cuts text inside an emoji
    // sends one); PostgreSQL stores U+FFFD in their place instead of refusing the response.
    it("stores answers with characters jsonb cannot hold, and a saved layout with them", async () => {
      const surveys = createSqlSurveyStore(database);
      const owner = randomUUID();
      const survey = await surveys.createSurvey({
        id: randomUUID(),
        name: "Odd text",
        owner: { kind: "personal", userId: owner },
        creatorId: owner,
        postId: randomUUID(),
        resultId: randomUUID(),
        createdAt: "2026-10-01T10:00:00.000Z",
        updatedAt: "2026-10-01T10:00:00.000Z",
      });
      const odd = { "key\u0000": "a\u0000b", cut: "x\ud800y", list: ["\udc00"] };
      const kept = dialect === "postgres" ? { "key�": "a�b", cut: "x�y", list: ["�"] } : odd;
      const results = createSqlResultStore(database);
      const id = randomUUID();
      expect(
        await results.appendResponse(survey, {
          id,
          submittedAt: "2026-10-01T11:00:00.000Z",
          data: odd,
        }),
      ).toBe("stored");
      expect((await results.listResponses(survey)).map((r) => r.data)).toEqual([kept]);
      const views = createSqlViewStore(database);
      await views.saveView(survey.id, owner, "table", odd);
      expect(await views.getView(survey.id, owner, "table")).toEqual(kept);
    });

    it("seeks a results page by (survey, submitted, id) in the index, not by scanning the survey's rows", async () => {
      const compiled = responsePageQuery(database.db, SURVEY, AFTER, 51).compile();
      if (dialect === "sqlite") {
        const plan = await database.db.executeQuery<{ detail: string }>(
          CompiledQuery.raw(`explain query plan ${compiled.sql}`, [...compiled.parameters]),
        );
        const details = plan.rows.map((row) => row.detail).join("\n");
        expect(details).toMatch(
          /USING INDEX survey_responses_order \(survey_id=\? AND \(?submitted_at/,
        );
        return;
      }
      // A tiny table would be scanned whatever the query: forbid that for this one transaction.
      const plan = await database.db.transaction().execute(async (trx) => {
        await sql`set local enable_seqscan = off`.execute(trx);
        return trx.executeQuery<{ "QUERY PLAN": unknown }>(
          CompiledQuery.raw(`explain (format json) ${compiled.sql}`, [...compiled.parameters]),
        );
      });
      const text = JSON.stringify(plan.rows[0]!["QUERY PLAN"]);
      const indexCond = /"Index Cond":"([^"]*)"/.exec(text)?.[1] ?? "";
      expect(text).toContain('"Index Name":"survey_responses_order"');
      expect(indexCond).toContain("submitted_at");
    });
  });
}
