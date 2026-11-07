import { randomUUID } from "node:crypto";
import type { Kysely, Selectable, Updateable } from "kysely";
import { contentVersion } from "../domain/content-version.js";
import { GUID } from "../domain/guid.js";
import { newSurveyRecord } from "../domain/survey-changes.js";
import type {
  SaveOutcome,
  SurveyChanges,
  SurveyDefinition,
  SurveyOwner,
  SurveyRecord,
  Versioned,
} from "../domain/types.js";
import type { SurveyStore } from "../providers/types.js";
import type { SqlDatabase, SqlDialectName } from "./database.js";
import type { DatabaseSchema, SurveysTable } from "./schema.js";
import { flagOf, isoOf, jsonOf, jsonText } from "./values.js";

const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

/** A GUID as stored (lower-case); null for a value that is not a GUID, which no row can have. */
const key = (id: string): string | null => (GUID.test(id) ? id.toLowerCase() : null);

/** The version of a stored document: the hash of the JSON text written, or of "" when none. */
export const versionOf = (content: Record<string, unknown> | undefined): string =>
  contentVersion(content === undefined ? "" : JSON.stringify(content));

const RECORD_COLUMNS = [
  "id",
  "name",
  "owner_user_id",
  "owner_project_id",
  "creator_id",
  "post_id",
  "result_id",
  "published",
  "archived",
  "public_results",
  "store_respondent_ip",
  "use_cookies",
  "created_at",
  "updated_at",
] as const;

type RecordRow = Pick<Selectable<SurveysTable>, (typeof RECORD_COLUMNS)[number]>;

const recordOf = (row: RecordRow): SurveyRecord => ({
  id: row.id,
  name: row.name,
  owner:
    row.owner_user_id !== null
      ? { kind: "personal", userId: row.owner_user_id }
      : { kind: "project", projectId: row.owner_project_id! },
  creatorId: row.creator_id,
  postId: row.post_id,
  resultId: row.result_id,
  published: flagOf(row.published),
  archived: flagOf(row.archived),
  createdAt: isoOf(row.created_at),
  updatedAt: isoOf(row.updated_at),
  settings: {
    publicResults: flagOf(row.public_results),
    storeRespondentIp: flagOf(row.store_respondent_ip),
    useCookies: flagOf(row.use_cookies),
  },
});

/** The columns of a record (ids lower-case, times as Date#toISOString writes them). */
const columnsOf = (record: SurveyRecord) => ({
  name: record.name,
  owner_user_id: record.owner.kind === "personal" ? record.owner.userId.toLowerCase() : null,
  owner_project_id: record.owner.kind === "project" ? record.owner.projectId.toLowerCase() : null,
  creator_id: record.creatorId?.toLowerCase() ?? null,
  post_id: record.postId.toLowerCase(),
  result_id: record.resultId.toLowerCase(),
  published: record.published,
  archived: record.archived,
  public_results: record.settings.publicResults,
  store_respondent_ip: record.settings.storeRespondentIp,
  use_cookies: record.settings.useCookies,
  created_at: isoOf(record.createdAt),
  updated_at: isoOf(record.updatedAt),
});

/**
 * The columns `changes` sets, as `applySurveyChanges` changes the record: a move sets the scope and
 * the creator, `settings.useCookies` is never changed, `updated_at` always is.
 */
const changedColumns = (changes: SurveyChanges): Updateable<SurveysTable> => {
  const { name, move, published, archived, settings, updatedAt } = changes;
  return {
    ...(name !== undefined && { name }),
    ...(move !== undefined && {
      owner_user_id: move.owner.kind === "personal" ? move.owner.userId.toLowerCase() : null,
      owner_project_id: move.owner.kind === "project" ? move.owner.projectId.toLowerCase() : null,
      creator_id: move.creatorId.toLowerCase(),
    }),
    ...(published !== undefined && { published }),
    ...(archived !== undefined && { archived }),
    ...(settings?.publicResults !== undefined && { public_results: settings.publicResults }),
    ...(settings?.storeRespondentIp !== undefined && {
      store_respondent_ip: settings.storeRespondentIp,
    }),
    updated_at: isoOf(updatedAt),
  };
};

/** What a survey is stored with besides its record. */
export interface StoredSurveyContent {
  readonly definition?: SurveyDefinition;
  readonly theme?: Record<string, unknown>;
  /** History entries with their snapshots; default none. */
  readonly history?: readonly {
    readonly id: string;
    readonly at: string;
    readonly userId: string | null;
    readonly snapshot: SurveyDefinition;
  }[];
}

/** Stores a survey row with its documents and history entries (create, clone and the seed). */
export async function insertSurvey(
  db: Kysely<DatabaseSchema>,
  dialect: SqlDialectName,
  record: SurveyRecord,
  content: StoredSurveyContent = {},
): Promise<void> {
  const id = record.id.toLowerCase();
  await db
    .insertInto("surveys")
    .values({
      id,
      ...columnsOf(record),
      definition: content.definition === undefined ? null : jsonText(dialect, content.definition),
      definition_version: versionOf(content.definition),
      theme: content.theme === undefined ? null : jsonText(dialect, content.theme),
      theme_version: versionOf(content.theme),
    })
    .execute();
  if (content.history && content.history.length > 0) {
    await db
      .insertInto("survey_history")
      .values(
        content.history.map((entry) => ({
          survey_id: id,
          id: entry.id.toLowerCase(),
          at: isoOf(entry.at),
          user_id: entry.userId?.toLowerCase() ?? null,
          snapshot: jsonText(dialect, entry.snapshot),
        })),
      )
      .execute();
  }
}

/**
 * Deletes a survey and everything stored for it: history, responses and markers by cascade, and the
 * results layouts and private questions, which have no foreign key. Run it inside a transaction.
 * false when there was no such survey.
 */
export async function deleteSurveyRows(
  trx: Kysely<DatabaseSchema>,
  survey: string,
): Promise<boolean> {
  for (const table of ["saved_views", "legacy_views", "private_questions"] as const) {
    await trx.deleteFrom(table).where("survey_id", "=", survey).execute();
  }
  const result = await trx.deleteFrom("surveys").where("id", "=", survey).executeTakeFirst();
  return result.numDeletedRows > 0n;
}

/** The survey store on SQLite or PostgreSQL (docs/architecture/data-model.md). */
export function createSqlSurveyStore(database: SqlDatabase): SurveyStore {
  const { db } = database;

  const selectRecords = () => db.selectFrom("surveys").select(RECORD_COLUMNS);

  const getRecord = async (id: string): Promise<SurveyRecord | null> => {
    const row = await selectRecords().where("id", "=", id).executeTakeFirst();
    return row ? recordOf(row) : null;
  };

  /** Rows of one scope; null when the scope's id is not a GUID. */
  const inScope = (owner: SurveyOwner) => {
    const ownerId = key(owner.kind === "personal" ? owner.userId : owner.projectId);
    if (ownerId === null) return null;
    return selectRecords().where(
      owner.kind === "personal" ? "owner_user_id" : "owner_project_id",
      "=",
      ownerId,
    );
  };

  /** A new survey with its first definition (and a history entry for it) and theme, if any. */
  const create = async (
    record: SurveyRecord,
    definition: SurveyDefinition | undefined,
    theme: Record<string, unknown> | undefined,
  ): Promise<SurveyRecord> => {
    await db.transaction().execute((trx) =>
      insertSurvey(trx, database.dialect, record, {
        ...(definition !== undefined && {
          definition,
          history: [
            {
              id: randomUUID(),
              at: record.createdAt,
              userId: record.creatorId,
              snapshot: definition,
            },
          ],
        }),
        ...(theme !== undefined && { theme }),
      }),
    );
    return (await getRecord(record.id))!;
  };

  const readDocument = async (
    id: string,
    column: "definition" | "theme",
  ): Promise<Versioned<Record<string, unknown>> | null> => {
    const survey = key(id);
    if (survey === null) return null;
    const row = await db
      .selectFrom("surveys")
      .select([column, `${column}_version` as const])
      .where("id", "=", survey)
      .executeTakeFirst();
    if (!row) return null;
    const stored = row[column];
    return {
      content: stored === null ? {} : jsonOf<Record<string, unknown>>(stored),
      version: (row as Record<string, unknown>)[`${column}_version`] as string,
    };
  };

  /**
   * Compare-and-set of one document in one statement: writes it, its version and `updated_at`
   * only while the stored version equals `ifVersion`. `afterSave` runs in the same transaction.
   */
  const writeDocument = (
    id: string,
    column: "definition" | "theme",
    content: Record<string, unknown>,
    save: { readonly ifVersion: string; readonly savedAt: string },
    afterSave?: (trx: Kysely<DatabaseSchema>, survey: string) => Promise<void>,
  ): Promise<SaveOutcome> => {
    const survey = key(id);
    if (survey === null) return Promise.resolve({ kind: "not-found" });
    const version = versionOf(content);
    return db.transaction().execute(async (trx) => {
      const versionColumn = column === "definition" ? "definition_version" : "theme_version";
      const result = await trx
        .updateTable("surveys")
        .set({
          [column]: jsonText(database.dialect, content),
          [versionColumn]: version,
          updated_at: isoOf(save.savedAt),
        })
        .where("id", "=", survey)
        .where(versionColumn, "=", save.ifVersion)
        .executeTakeFirst();
      if (result.numUpdatedRows === 0n) {
        const exists = await trx
          .selectFrom("surveys")
          .select("id")
          .where("id", "=", survey)
          .executeTakeFirst();
        return { kind: exists ? "conflict" : "not-found" };
      }
      await afterSave?.(trx, survey);
      return { kind: "saved", version };
    });
  };

  return {
    getSurvey: (id) => {
      const survey = key(id);
      return survey === null ? Promise.resolve(null) : getRecord(survey);
    },
    listSurveys: async (owner) => {
      const rows = await inScope(owner)
        ?.orderBy("updated_at", "desc")
        .orderBy("id", "asc")
        .execute();
      return (rows ?? []).map(recordOf);
    },
    listSurveyPage: async ({ owner, archived, after, limit }) => {
      let query = inScope(owner)?.where("archived", "=", archived);
      if (!query) return { items: [], next: null };
      if (after) {
        const at = isoOf(after.updatedAt);
        const afterId = after.id.toLowerCase();
        query = query.where((eb) =>
          eb.or([
            eb("updated_at", "<", at),
            eb.and([eb("updated_at", "=", at), eb("id", ">", afterId)]),
          ]),
        );
      }
      const rows = await query
        .orderBy("updated_at", "desc")
        .orderBy("id", "asc")
        .limit(limit + 1)
        .execute();
      const items = rows.slice(0, limit).map(recordOf);
      const last = items.at(-1);
      return {
        items,
        next: rows.length > limit && last ? { updatedAt: last.updatedAt, id: last.id } : null,
      };
    },
    createSurvey: (survey, definition) => create(newSurveyRecord(survey), definition, undefined),
    getDefinition: (id) => readDocument(id, "definition"),
    getTheme: (id) => readDocument(id, "theme"),
    saveDefinition: (id, definition, { ifVersion, userId, savedAt }) =>
      writeDocument(id, "definition", definition, { ifVersion, savedAt }, async (trx, survey) => {
        await trx
          .insertInto("survey_history")
          .values({
            survey_id: survey,
            id: randomUUID(),
            at: isoOf(savedAt),
            user_id: userId.toLowerCase(),
            snapshot: jsonText(database.dialect, definition),
          })
          .execute();
      }),
    saveTheme: (id, theme, { ifVersion, savedAt }) =>
      writeDocument(id, "theme", theme, { ifVersion, savedAt }),
    listHistory: async ({ surveyId, after, limit }) => {
      const survey = key(surveyId);
      if (survey === null) return { items: [], next: null };
      let query = db
        .selectFrom("survey_history")
        .select(["id", "at", "user_id"])
        .where("survey_id", "=", survey);
      if (after) {
        const at = isoOf(after.at);
        const afterId = after.id.toLowerCase();
        query = query.where((eb) =>
          eb.or([eb("at", "<", at), eb.and([eb("at", "=", at), eb("id", "<", afterId)])]),
        );
      }
      const rows = await query
        .orderBy("at", "desc")
        .orderBy("id", "desc")
        .limit(limit + 1)
        .execute();
      const items = rows
        .slice(0, limit)
        .map((row) => ({ id: row.id, at: isoOf(row.at), userId: row.user_id }));
      const last = items.at(-1);
      return { items, next: rows.length > limit && last ? { at: last.at, id: last.id } : null };
    },
    getHistorySnapshot: async (surveyId, entryId) => {
      const survey = key(surveyId);
      const entry = key(entryId);
      if (survey === null || entry === null) return null;
      const row = await db
        .selectFrom("survey_history")
        .select("snapshot")
        .where("survey_id", "=", survey)
        .where("id", "=", entry)
        .executeTakeFirst();
      return row ? jsonOf<SurveyDefinition>(row.snapshot) : null;
    },
    // One statement that sets only the named columns: no change depends on the stored values, so
    // updates running at the same time never undo each other (a read-then-write would).
    updateSurvey: async (id, changes) => {
      const survey = key(id);
      if (survey === null) return null;
      const result = await db
        .updateTable("surveys")
        .set(changedColumns(changes))
        .where("id", "=", survey)
        .executeTakeFirst();
      return result.numUpdatedRows === 0n ? null : getRecord(survey);
    },
    cloneSurvey: async (sourceId, copy, options) => {
      const source = key(sourceId);
      if (source === null) return null;
      const row = await db
        .selectFrom("surveys")
        .select(["definition", "theme"])
        .where("id", "=", source)
        .executeTakeFirst();
      if (!row) return null;
      const rewrite = options?.rewriteText;
      const copied = (stored: unknown): Record<string, unknown> | undefined => {
        if (stored === null) return undefined;
        const document = jsonOf<Record<string, unknown>>(stored);
        return rewrite
          ? (JSON.parse(rewrite(JSON.stringify(document))) as Record<string, unknown>)
          : document;
      };
      return create(newSurveyRecord(copy), copied(row.definition), copied(row.theme));
    },
    deleteSurvey: async (id) => {
      const survey = key(id);
      if (survey === null) return false;
      return db.transaction().execute((trx) => deleteSurveyRows(trx, survey));
    },
    listPersonalOwnerIds: async () => {
      const rows = await db
        .selectFrom("surveys")
        .select("owner_user_id")
        .distinct()
        .where("owner_user_id", "is not", null)
        .orderBy("owner_user_id")
        .execute();
      return rows
        .map((row) => row.owner_user_id!)
        .filter((id) => GUID.test(id) && id !== ZERO_GUID);
    },
    listSurveyIds: async (owner) => {
      const ownerId = key(owner.kind === "personal" ? owner.userId : owner.projectId);
      if (ownerId === null) return [];
      const rows = await db
        .selectFrom("surveys")
        .select("id")
        .where(owner.kind === "personal" ? "owner_user_id" : "owner_project_id", "=", ownerId)
        .orderBy("id")
        .execute();
      return rows.map((row) => row.id);
    },
  };
}
