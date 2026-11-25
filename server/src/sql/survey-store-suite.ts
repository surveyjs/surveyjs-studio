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

    describe("HISTORY_MAX_ENTRIES", () => {
      const newSurvey = async (target: SurveyStore) => {
        const owner = randomUUID();
        return target.createSurvey({
          id: randomUUID(),
          name: "History",
          owner: { kind: "personal", userId: owner },
          creatorId: owner,
          postId: randomUUID(),
          resultId: randomUUID(),
          createdAt: "2026-10-01T10:00:00.000Z",
          updatedAt: "2026-10-01T10:00:00.000Z",
        });
      };
      /** Saves `title` at `savedAt`; the version is read first, so the save is not a conflict. */
      const save = async (target: SurveyStore, id: string, title: string, savedAt: string) => {
        const current = await target.getDefinition(id);
        return target.saveDefinition(
          id,
          { title },
          {
            ifVersion: current!.version,
            userId: randomUUID(),
            savedAt,
          },
        );
      };
      const historyOf = async (target: SurveyStore, id: string) =>
        (await target.listHistory({ surveyId: id, limit: 100 })).items;
      const atOf = (n: number) => `2026-10-02T10:00:0${n}.000Z`;

      it("keeps the newest N entries in the history order, and all without a limit", async () => {
        const limited = createSqlSurveyStore(database, { historyMaxEntries: 3 });
        const a = await newSurvey(limited);
        const b = await newSurvey(store);
        for (let n = 1; n <= 5; n++) {
          await save(limited, a.id, `v${n}`, atOf(n));
          await save(store, b.id, `v${n}`, atOf(n));
        }
        const all = await historyOf(store, b.id);
        expect(all).toHaveLength(5);
        expect((await historyOf(limited, a.id)).map((e) => e.at)).toEqual([
          atOf(5),
          atOf(4),
          atOf(3),
        ]);
      });

      it("keeps the newest N by time, then id, when saves share a time", async () => {
        const survey = await newSurvey(store);
        for (let n = 1; n <= 5; n++) await save(store, survey.id, `v${n}`, atOf(2));
        const known = (await historyOf(store, survey.id)).map((e) => e.id);
        expect(known).toHaveLength(5);
        // The sixth save's own id is unknown, and it may be the one dropped.
        const limited = createSqlSurveyStore(database, { historyMaxEntries: 3 });
        await save(limited, survey.id, "v6", atOf(2));
        const kept = (await historyOf(limited, survey.id)).map((e) => e.id);
        expect(kept).toHaveLength(3);
        const lowestKept = kept.reduce((low, id) => (id < low ? id : low));
        for (const id of known.filter((k) => !kept.includes(k))) expect(id < lowestKept).toBe(true);
        expect(kept).toEqual([...kept].sort().reverse());
      });

      it("keeps everything below N, exactly N, and prunes one at N+1", async () => {
        const limited = createSqlSurveyStore(database, { historyMaxEntries: 3 });
        const survey = await newSurvey(limited);
        const lengths: number[] = [];
        for (let n = 1; n <= 4; n++) {
          await save(limited, survey.id, `v${n}`, atOf(n));
          lengths.push((await historyOf(limited, survey.id)).length);
        }
        expect(lengths).toEqual([1, 2, 3, 3]);
      });

      it("prunes nothing when the save is a version conflict", async () => {
        const limited = createSqlSurveyStore(database, { historyMaxEntries: 3 });
        const survey = await newSurvey(limited);
        for (let n = 1; n <= 3; n++) await save(limited, survey.id, `v${n}`, atOf(n));
        const before = await historyOf(limited, survey.id);
        const outcome = await limited.saveDefinition(
          survey.id,
          { title: "stale" },
          { ifVersion: "stale", userId: randomUUID(), savedAt: atOf(4) },
        );
        expect(outcome.kind).toBe("conflict");
        expect(await historyOf(limited, survey.id)).toEqual(before);
      });
    });
  });
}
