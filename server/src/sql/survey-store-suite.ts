import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SurveyStore } from "../providers/types.js";
import { openDatabase, type SqlDatabase, type SqlDialectName } from "./database.js";
import { migrate } from "./migrator.js";
import { scratchDatabase, type ScratchDatabase } from "./scratch-databases.js";
import { createSqlSurveyStore } from "./survey-store.js";

/** What the SQL survey store must do beyond the provider suite: writes that run at the same time. */
export function describeSqlSurveyStoreSuite(dialect: SqlDialectName): void {
  describe(`SQL survey store: ${dialect}`, () => {
    let scratch: ScratchDatabase;
    let database: SqlDatabase;
    let store: SurveyStore;
    beforeAll(async () => {
      scratch = await scratchDatabase(dialect);
      database = openDatabase(scratch.target);
      await migrate(database);
      store = createSqlSurveyStore(database);
    });
    afterAll(async () => {
      await database.close();
      await scratch.drop();
    });

    it("keeps every change of updates to one survey that run at the same time", async () => {
      const owner = randomUUID();
      for (let round = 0; round < 20; round++) {
        const survey = await store.createSurvey({
          id: randomUUID(),
          name: "Before",
          owner: { kind: "personal", userId: owner },
          creatorId: owner,
          postId: randomUUID(),
          resultId: randomUUID(),
          createdAt: "2026-10-01T10:00:00.000Z",
          updatedAt: "2026-10-01T10:00:00.000Z",
        });
        const updatedAt = "2026-10-02T10:00:00.000Z";
        await Promise.all([
          store.updateSurvey(survey.id, { name: "After", updatedAt }),
          store.updateSurvey(survey.id, { archived: true, updatedAt }),
          store.updateSurvey(survey.id, { published: false, updatedAt }),
          store.updateSurvey(survey.id, { settings: { publicResults: true }, updatedAt }),
        ]);
        expect(await store.getSurvey(survey.id)).toMatchObject({
          name: "After",
          archived: true,
          published: false,
          settings: { publicResults: true, storeRespondentIp: false },
          updatedAt,
        });
      }
    });
  });
}
