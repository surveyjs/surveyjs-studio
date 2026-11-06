import type { MemorySeed } from "../providers/memory.js";
import type { SqlDatabase } from "./database.js";
import { insertSurvey } from "./survey-store.js";

export interface SeedReport {
  readonly surveys: number;
}

/**
 * Loads the shared seed into the SQL stores built so far (surveys with their definitions, themes
 * and history), in one transaction. A seed survey that exists is replaced with its history; every
 * other row stays, so running it again resets the seed data and keeps what people made.
 */
export async function seedSqlStores(database: SqlDatabase, seed: MemorySeed): Promise<SeedReport> {
  const byId = <T>(map: Record<string, T> | undefined, id: string): T | undefined =>
    Object.entries(map ?? {}).find(([key]) => key.toLowerCase() === id)?.[1];
  await database.db.transaction().execute(async (trx) => {
    for (const survey of seed.surveys) {
      const id = survey.id.toLowerCase();
      await trx.deleteFrom("surveys").where("id", "=", id).execute();
      const definition = byId(seed.definitions, id);
      const theme = byId(seed.themes, id);
      await insertSurvey(trx, survey, {
        ...(definition !== undefined && { definition }),
        ...(theme !== undefined && { theme }),
        history: byId(seed.history, id) ?? [],
      });
    }
  });
  return { surveys: seed.surveys.length };
}
