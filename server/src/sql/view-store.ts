import { GUID } from "../domain/guid.js";
import type { ViewName, ViewState } from "../domain/types.js";
import type { ViewStore } from "../providers/types.js";
import type { SqlDatabase } from "./database.js";
import { jsonOf } from "./values.js";

/** A stored state that is a JSON object; null for anything else (read as "no state"). */
const stateOf = (stored: unknown): ViewState | null => {
  const state = jsonOf<unknown>(stored);
  return typeof state === "object" && state !== null && !Array.isArray(state)
    ? (state as ViewState)
    : null;
};

/**
 * The view store on SQLite or PostgreSQL (docs/architecture/data-model.md): the users' saved
 * layouts (a null state is a reset marker), the legacy per-survey layouts and the private-question
 * lists. It does not check that a survey exists; `deleteSurvey` deletes these rows.
 */
export function createSqlViewStore(database: SqlDatabase): ViewStore {
  const { db } = database;

  const write = async (
    surveyId: string,
    userId: string,
    view: ViewName,
    state: ViewState | null,
  ): Promise<void> => {
    if (!GUID.test(surveyId) || !GUID.test(userId)) throw new Error("View ids must be GUIDs");
    const text = state === null ? null : JSON.stringify(state);
    const updatedAt = new Date().toISOString();
    await db
      .insertInto("saved_views")
      .values({
        survey_id: surveyId.toLowerCase(),
        user_id: userId.toLowerCase(),
        view,
        state: text,
        updated_at: updatedAt,
      })
      .onConflict((oc) =>
        oc
          .columns(["survey_id", "user_id", "view"])
          .doUpdateSet({ state: text, updated_at: updatedAt }),
      )
      .execute();
  };

  return {
    getView: async (surveyId, userId, view) => {
      if (!GUID.test(surveyId) || !GUID.test(userId)) return null;
      const survey = surveyId.toLowerCase();
      const own = await db
        .selectFrom("saved_views")
        .select("state")
        .where("survey_id", "=", survey)
        .where("user_id", "=", userId.toLowerCase())
        .where("view", "=", view)
        .executeTakeFirst();
      if (own) return own.state === null ? null : stateOf(own.state);
      const legacy = await db
        .selectFrom("legacy_views")
        .select("state")
        .where("survey_id", "=", survey)
        .where("view", "=", view)
        .executeTakeFirst();
      return legacy ? stateOf(legacy.state) : null;
    },
    saveView: (surveyId, userId, view, state) => write(surveyId, userId, view, state),
    resetView: (surveyId, userId, view) => write(surveyId, userId, view, null),
    getPrivateQuestions: async (surveyId) => {
      if (!GUID.test(surveyId)) return [];
      const row = await db
        .selectFrom("private_questions")
        .select("names")
        .where("survey_id", "=", surveyId.toLowerCase())
        .executeTakeFirst();
      if (!row) return [];
      const names = jsonOf<unknown>(row.names);
      return Array.isArray(names) ? names.filter((n): n is string => typeof n === "string") : [];
    },
    savePrivateQuestions: async (surveyId, names) => {
      if (!GUID.test(surveyId)) throw new Error("View ids must be GUIDs");
      const text = JSON.stringify([...new Set(names)]);
      await db
        .insertInto("private_questions")
        .values({ survey_id: surveyId.toLowerCase(), names: text })
        .onConflict((oc) => oc.column("survey_id").doUpdateSet({ names: text }))
        .execute();
    },
  };
}
