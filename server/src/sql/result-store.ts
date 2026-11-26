import type { Kysely, Selectable } from "kysely";
import { GUID } from "../domain/guid.js";
import type { CompletionState, SurveyResponse } from "../domain/types.js";
import { pageOfRuns, runHolding, type ResponseWindow } from "../providers/runs.js";
import type { ResponsePosition, ResultStore } from "../providers/types.js";
import type { SqlDatabase, SqlDialectName } from "./database.js";
import type { DatabaseSchema, SurveyResponsesTable } from "./schema.js";
import { flagOf, isoOf, jsonOf, jsonText } from "./values.js";

const RESPONSE_COLUMNS = [
  "id",
  "submitted_at",
  "data",
  "client_id",
  "respondent_ip",
  "partial",
] as const;

type ResponseRow = Pick<Selectable<SurveyResponsesTable>, (typeof RESPONSE_COLUMNS)[number]>;

/** A stored row as the store reads it (the migration tool's `verify` reads rows unfolded). */
export const responseOf = (row: ResponseRow): SurveyResponse => ({
  id: row.id,
  submittedAt: isoOf(row.submitted_at),
  data: jsonOf<Record<string, unknown>>(row.data),
  ...(row.client_id !== null && { clientId: row.client_id }),
  ...(row.respondent_ip !== null && { respondentIp: row.respondent_ip }),
  partial: flagOf(row.partial),
});

/** Stores responses (the seed and the hosted migration keep their ids, times and partial flags). */
export async function insertResponses(
  db: Kysely<DatabaseSchema>,
  dialect: SqlDialectName,
  surveyId: string,
  responses: readonly SurveyResponse[],
): Promise<void> {
  // Small batches keep every statement under SQLite's and PostgreSQL's parameter limits.
  for (let start = 0; start < responses.length; start += 200) {
    await db
      .insertInto("survey_responses")
      .values(
        responses.slice(start, start + 200).map((response) => ({
          survey_id: surveyId.toLowerCase(),
          id: response.id.toLowerCase(),
          submitted_at: isoOf(response.submittedAt),
          data: jsonText(dialect, response.data),
          client_id: response.clientId ?? null,
          respondent_ip: response.respondentIp ?? null,
          partial: response.partial,
        })),
      )
      .execute();
  }
}

/**
 * One page of a survey's responses in submission order, strictly after `after` and strictly
 * between the window's `from` and `till`: at most `limit` rows. Exported for the test that checks
 * its query plan.
 */
export function responsePageQuery(
  db: Kysely<DatabaseSchema>,
  surveyId: string,
  after: ResponsePosition | undefined,
  limit: number,
  window: ResponseWindow = {},
) {
  let query = db
    .selectFrom("survey_responses")
    .select(RESPONSE_COLUMNS)
    .where("survey_id", "=", surveyId.toLowerCase());
  // As instants: isoOf writes the bound as the column's values are written.
  if (window.from !== undefined) query = query.where("submitted_at", ">", isoOf(window.from));
  if (window.till !== undefined) query = query.where("submitted_at", "<", isoOf(window.till));
  if (after) {
    const at = isoOf(after.submittedAt);
    const afterId = after.id.toLowerCase();
    // A row-value comparison, which both databases seek in survey_responses_order; the equivalent
    // `submitted_at > ? or (submitted_at = ? and id > ?)` only seeks the survey and filters its rows.
    query = query.where((eb) => eb(eb.refTuple("submitted_at", "id"), ">", eb.tuple(at, afterId)));
  }
  return query.orderBy("submitted_at").orderBy("id").limit(limit);
}

/** The result store on SQLite or PostgreSQL (docs/architecture/data-model.md). */
export function createSqlResultStore(database: SqlDatabase): ResultStore {
  const { db } = database;

  const ofSurvey = (surveyId: string) =>
    db
      .selectFrom("survey_responses")
      .select(RESPONSE_COLUMNS)
      .where("survey_id", "=", surveyId.toLowerCase());

  return {
    appendResponse: async (survey, response) => {
      if (!GUID.test(response.id)) throw new Error("The response id is not a GUID");
      const surveyId = survey.id.toLowerCase();
      // Without a client id there is no marker to be partial, and the row is stored as complete.
      const partial = response.partial === true && response.clientId !== undefined;
      return db.transaction().execute(async (trx) => {
        const inserted = await trx
          .insertInto("survey_responses")
          .values({
            survey_id: surveyId,
            id: response.id.toLowerCase(),
            submitted_at: isoOf(response.submittedAt),
            data: jsonText(database.dialect, response.data),
            client_id: response.clientId ?? null,
            respondent_ip: response.respondentIp ?? null,
            partial,
          })
          .onConflict((oc) => oc.columns(["survey_id", "id"]).doNothing())
          .executeTakeFirst();
        // Written for a repeated id too: it repairs a marker lost to a failure after the row.
        if (response.clientId !== undefined) {
          await trx
            .insertInto("completion_markers")
            .values({ survey_id: surveyId, client_id: response.clientId, partial })
            .onConflict((oc) => oc.columns(["survey_id", "client_id"]).doUpdateSet({ partial }))
            .execute();
        }
        return (inserted.numInsertedOrUpdatedRows ?? 0n) > 0n ? "stored" : "exists";
      });
    },
    hasResponse: async (survey, id) => {
      if (!GUID.test(id)) return false;
      const row = await db
        .selectFrom("survey_responses")
        .select("id")
        .where("survey_id", "=", survey.id.toLowerCase())
        .where("id", "=", id.toLowerCase())
        .executeTakeFirst();
      return row !== undefined;
    },
    listResponses: async (survey) => {
      const rows = await ofSurvey(survey.id).orderBy("submitted_at").orderBy("id").execute();
      return rows.map(responseOf);
    },
    stats: async (survey) => {
      const row = await db
        .selectFrom("survey_responses")
        .select((eb) => [
          eb.fn.countAll<number | string | bigint>().as("count"),
          eb.fn.min("submitted_at").as("first"),
          eb.fn.max("submitted_at").as("last"),
        ])
        .where("survey_id", "=", survey.id.toLowerCase())
        .where("partial", "=", false)
        .executeTakeFirstOrThrow();
      return {
        count: Number(row.count),
        firstSubmittedAt: row.first === null ? null : isoOf(row.first),
        lastSubmittedAt: row.last === null ? null : isoOf(row.last),
      };
    },
    hasPartial: async (survey) => {
      const row = await db
        .selectFrom("completion_markers")
        .select("client_id")
        .where("survey_id", "=", survey.id.toLowerCase())
        .where("partial", "=", true)
        .limit(1)
        .executeTakeFirst();
      return row !== undefined;
    },
    completion: async (survey, clientId): Promise<CompletionState> => {
      const row = await db
        .selectFrom("completion_markers")
        .select("partial")
        .where("survey_id", "=", survey.id.toLowerCase())
        .where("client_id", "=", clientId)
        .executeTakeFirst();
      if (!row) return "none";
      return flagOf(row.partial) ? "partial" : "completed";
    },
    listResponsePage: async (survey, query) => {
      const surveyId = survey.id.toLowerCase();
      return pageOfRuns(
        {
          rowsAfter: async (after, limit, window) =>
            (await responsePageQuery(db, surveyId, after, limit, window).execute()).map(responseOf),
          // At most limit + 1 ids (limit is at most 1000), under both databases' parameter limits.
          partialClientRows: async (clientIds) => {
            if (clientIds.length === 0) return [];
            const rows = await ofSurvey(surveyId)
              .where("client_id", "in", clientIds)
              .where("client_id", "in", (eb) =>
                eb
                  .selectFrom("survey_responses")
                  .select("client_id")
                  .where("survey_id", "=", surveyId)
                  .where("partial", "=", true)
                  .where("client_id", "in", clientIds),
              )
              .orderBy("submitted_at")
              .orderBy("id")
              .execute();
            return rows.map(responseOf);
          },
        },
        query,
      );
    },
    deleteAll: async (survey) => {
      const surveyId = survey.id.toLowerCase();
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom("survey_responses").where("survey_id", "=", surveyId).execute();
        await trx.deleteFrom("completion_markers").where("survey_id", "=", surveyId).execute();
      });
    },
    deleteResponse: async (survey, responseId) => {
      if (!GUID.test(responseId)) return false;
      const surveyId = survey.id.toLowerCase();
      return db.transaction().execute(async (trx) => {
        const target = await trx
          .selectFrom("survey_responses")
          .select(["id", "client_id"])
          .where("survey_id", "=", surveyId)
          .where("id", "=", responseId.toLowerCase())
          .executeTakeFirst();
        if (!target) return false;
        const clientId = target.client_id;
        let run: readonly { id: string }[] = [target];
        let laterRun = false;
        if (clientId !== null) {
          // PostgreSQL: a save of this client waits for the delete at its marker write, so the
          // client's rows read next are all there are until the delete commits (SQLite runs one
          // write transaction at a time).
          let marker = trx
            .selectFrom("completion_markers")
            .select("client_id")
            .where("survey_id", "=", surveyId)
            .where("client_id", "=", clientId);
          if (database.dialect === "postgres") marker = marker.forUpdate();
          await marker.execute();
          const rows = await trx
            .selectFrom("survey_responses")
            .select(["id", "submitted_at", "partial"])
            .where("survey_id", "=", surveyId)
            .where("client_id", "=", clientId)
            .orderBy("submitted_at")
            .orderBy("id")
            .execute();
          const found = runHolding(
            rows.map((row) => ({
              id: row.id,
              submittedAt: isoOf(row.submitted_at),
              clientId,
              partial: flagOf(row.partial),
            })),
            target.id,
          );
          if (!found) return false;
          ({ run, laterRun } = found);
        }
        // Small batches keep every statement under both databases' parameter limits.
        for (let start = 0; start < run.length; start += 500) {
          await trx
            .deleteFrom("survey_responses")
            .where("survey_id", "=", surveyId)
            .where(
              "id",
              "in",
              run.slice(start, start + 500).map((row) => row.id),
            )
            .execute();
        }
        if (clientId !== null && !laterRun) {
          await trx
            .deleteFrom("completion_markers")
            .where("survey_id", "=", surveyId)
            .where("client_id", "=", clientId)
            .execute();
        }
        return true;
      });
    },
  };
}
