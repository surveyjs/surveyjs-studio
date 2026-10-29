import type { MemorySeed } from "../providers/memory.js";
import type { SqlDatabase } from "./database.js";
import { insertResponses } from "./result-store.js";
import { deleteSurveyRows, insertSurvey } from "./survey-store.js";
import { isoOf, jsonText } from "./values.js";

/** When the seed's accounts were made. */
const SEEDED_AT = "2025-01-01T00:00:00.000Z";

export interface SeedReport {
  readonly surveys: number;
  readonly projects: number;
}

/**
 * Loads the shared seed into the SQL stores (surveys with their definitions, themes, history,
 * responses, markers and layouts; projects with their members), in one transaction. A seed
 * survey or project that exists is replaced with what belongs to it; every other row stays, so
 * running it again resets the seed data and keeps what people made.
 */
export async function seedSqlStores(database: SqlDatabase, seed: MemorySeed): Promise<SeedReport> {
  const byId = <T>(map: Record<string, T> | undefined, id: string): T | undefined =>
    Object.entries(map ?? {}).find(([key]) => key.toLowerCase() === id)?.[1];
  await database.db.transaction().execute(async (trx) => {
    // The seed users as local accounts without a password (USER_DIRECTORY=local reads them; the
    // memory directory has its own copy). A blocked user is a disabled account.
    for (const user of seed.users) {
      const id = user.id.toLowerCase();
      await trx.deleteFrom("users").where("id", "=", id).execute();
      await trx
        .insertInto("users")
        .values({
          id,
          email: user.email.toLowerCase(),
          display_name: user.displayName,
          instance_role: "user",
          status: user.blocked ? "disabled" : "active",
          password_hash: null,
          must_change_password: false,
          session_epoch: 0,
          created_at: SEEDED_AT,
          last_sign_in_at: null,
        })
        .execute();
    }
    for (const survey of seed.surveys) {
      const id = survey.id.toLowerCase();
      await deleteSurveyRows(trx, id);
      const definition = byId(seed.definitions, id);
      const theme = byId(seed.themes, id);
      await insertSurvey(trx, database.dialect, survey, {
        ...(definition !== undefined && { definition }),
        ...(theme !== undefined && { theme }),
        history: byId(seed.history, id) ?? [],
      });
      // The survey's responses and markers went with it (cascade).
      await insertResponses(trx, database.dialect, id, byId(seed.responses, id) ?? []);
      const markers = Object.entries(byId(seed.completions, id) ?? {});
      if (markers.length > 0) {
        await trx
          .insertInto("completion_markers")
          .values(
            markers.map(([clientId, { partial }]) => ({
              survey_id: id,
              client_id: clientId,
              partial,
            })),
          )
          .execute();
      }
      const legacyViews = Object.entries(byId(seed.legacyViews, id) ?? {});
      if (legacyViews.length > 0) {
        await trx
          .insertInto("legacy_views")
          .values(
            legacyViews.map(([view, state]) => ({
              survey_id: id,
              view: view as "summary" | "table",
              state: jsonText(database.dialect, state),
            })),
          )
          .execute();
      }
      const privateQuestions = byId(seed.privateResultQuestions, id);
      if (privateQuestions !== undefined) {
        await trx
          .insertInto("private_questions")
          .values({ survey_id: id, names: jsonText(database.dialect, privateQuestions) })
          .execute();
      }
    }
    // A seed project is replaced with its memberships (cascade); its surveys stay where they are.
    for (const project of seed.projects) {
      const id = project.id.toLowerCase();
      const createdAt = isoOf(project.createdAt);
      await trx.deleteFrom("projects").where("id", "=", id).execute();
      await trx
        .insertInto("projects")
        .values({
          id,
          name: project.name,
          creator_id: project.creatorId?.toLowerCase() ?? null,
          created_at: createdAt,
        })
        .execute();
      const members = seed.memberships.filter((m) => m.projectId.toLowerCase() === id);
      if (members.length > 0) {
        await trx
          .insertInto("project_members")
          .values(
            members.map((m) => ({
              project_id: id,
              user_id: m.userId.toLowerCase(),
              role: m.role,
              created_at: createdAt,
              updated_at: createdAt,
            })),
          )
          .execute();
      }
    }
  });
  return { surveys: seed.surveys.length, projects: seed.projects.length };
}
