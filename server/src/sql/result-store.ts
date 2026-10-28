import type { Kysely, Selectable } from "kysely";
import { GUID } from "../domain/guid.js";
import type { CompletionState, SurveyResponse } from "../domain/types.js";
import type { ResultStore } from "../providers/types.js";
import type { SqlDatabase } from "./database.js";
import type { DatabaseSchema, SurveyResponsesTable } from "./schema.js";
import { flagOf, isoOf, jsonOf } from "./values.js";

const RESPONSE_COLUMNS = [
  "id",
  "submitted_at",
  "data",
  "client_id",
  "respondent_ip",
  "partial",
] as const;

type ResponseRow = Pick<Selectable<SurveyResponsesTable>, (typeof RESPONSE_COLUMNS)[number]>;

const responseOf = (row: ResponseRow): SurveyResponse => ({
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
          data: JSON.stringify(response.data),
          client_id: response.clientId ?? null,
          respondent_ip: response.respondentIp ?? null,
          partial: response.partial,
        })),
      )
      .execute();
  }
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
      return db.transaction().execute(async (trx) => {
        const inserted = await trx
          .insertInto("survey_responses")
          .values({
            survey_id: surveyId,
            id: response.id.toLowerCase(),
            submitted_at: isoOf(response.submittedAt),
            data: JSON.stringify(response.data),
            client_id: response.clientId ?? null,
            respondent_ip: response.respondentIp ?? null,
            partial: false,
          })
          .onConflict((oc) => oc.columns(["survey_id", "id"]).doNothing())
          .executeTakeFirst();
        // Written for a repeated id too: it repairs a marker lost to a failure after the row.
        if (response.clientId !== undefined) {
          await trx
            .insertInto("completion_markers")
            .values({ survey_id: surveyId, client_id: response.clientId, partial: false })
            .onConflict((oc) =>
              oc.columns(["survey_id", "client_id"]).doUpdateSet({ partial: false }),
            )
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
        .executeTakeFirstOrThrow();
      return {
        count: Number(row.count),
        firstSubmittedAt: row.first === null ? null : isoOf(row.first),
        lastSubmittedAt: row.last === null ? null : isoOf(row.last),
      };
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
    listResponsePage: async (survey, { after, limit }) => {
      let query = ofSurvey(survey.id);
      if (after) {
        const at = isoOf(after.submittedAt);
        const afterId = after.id.toLowerCase();
        query = query.where((eb) =>
          eb.or([
            eb("submitted_at", ">", at),
            eb.and([eb("submitted_at", "=", at), eb("id", ">", afterId)]),
          ]),
        );
      }
      const rows = await query
        .orderBy("submitted_at")
        .orderBy("id")
        .limit(limit + 1)
        .execute();
      const items = rows.slice(0, limit).map(responseOf);
      const last = items.at(-1);
      return {
        items,
        next: rows.length > limit && last ? { submittedAt: last.submittedAt, id: last.id } : null,
      };
    },
    deleteAll: async (survey) => {
      const surveyId = survey.id.toLowerCase();
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom("survey_responses").where("survey_id", "=", surveyId).execute();
        await trx.deleteFrom("completion_markers").where("survey_id", "=", surveyId).execute();
      });
    },
  };
}
