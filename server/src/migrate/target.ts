/**
 * Where the migration tool writes: Studio's own tables and byte store, as idempotent upserts
 * (`insert … on conflict (primary key) do update`, on SQLite and PostgreSQL). A second run with the
 * same records leaves identical rows, and one with changed records takes the new values, which is
 * what `delta` relies on. The records are already normalised; an id that is not a GUID fails here
 * rather than going into a row.
 */
import { sql, type Kysely } from "kysely";
import type { ByteStore } from "../bytes/types.js";
import { GUID } from "../domain/guid.js";
import type { SqlDatabase } from "../sql/database.js";
import type { LayoutKind, SurveyOwner } from "../domain/types.js";
import type { DatabaseSchema } from "../sql/schema.js";
import { columnsOf, deleteSurveyRows, versionOf } from "../sql/survey-store.js";
import { flagOf, isoOf, jsonOf, jsonText } from "../sql/values.js";
import type {
  DeletedRec,
  EventRec,
  FileRec,
  HistoryRec,
  KeyRec,
  LayoutRec,
  MarkerRec,
  MemberRec,
  PersonRec,
  ProjectRec,
  ResponseRec,
  SurveyRec,
  ViewRec,
} from "./records.js";
import { createMigrationState, type MigrationState } from "./state.js";

export interface MigrationTarget {
  upsertSurvey(rec: SurveyRec): Promise<void>;
  /** The survey's stored private questions; [] for none (or no such survey). */
  privateQuestionsOf(surveyId: string): Promise<string[]>;
  /** Every id of the table, ascending (`verify` looks for rows the source no longer has). */
  idsOf(table: "surveys" | "projects" | "users"): Promise<string[]>;
  /**
   * `verify`: how many rows the table holds, the survey's only when one is given. `files`: the
   * files of a survey (Studio's own), not the old service's files of the zero survey.
   */
  countRows(table: CountedTable, surveyId?: string): Promise<number>;
  /**
   * `verify`: those of `keys` the table holds (the survey's only, when given), each once. The key
   * of a row: a marker's client id, `{surveyId}/{userId}/{view}` of a saved view, an event's id, a
   * deleted copy's response id, a file's id, `{kind}/{legacyName}` of a legacy file.
   */
  existingKeys(table: CountedTable, keys: readonly string[], surveyId?: string): Promise<string[]>;
  /**
   * `reconcile`: the keys (as `existingKeys` names them) of the table's rows, ascending, the
   * survey's only when one is given; `files` as `countRows` scopes them (Studio's own).
   */
  keysOf(table: CountedTable, surveyId?: string): Promise<string[]>;
  /** `reconcile`: every person the stored history names, ascending. */
  historyAuthors(): Promise<string[]>;
  /** `reconcile`: every survey's stored owner, by survey id. */
  surveyOwners(): Promise<Map<string, SurveyOwner>>;
  /**
   * `reconcile`: the accounts the migration pre-created that nobody has used, ascending: role
   * `user`, no password, never signed in, and no identity but the `surveyjs` one whose subject
   * is the account's own id. No other account is ever removed by the tool.
   */
  seededPeople(): Promise<string[]>;
  /** `reconcile`: every member row of every project, by project then user. */
  projectMembers(): Promise<{ projectId: string; userId: string; role: string }[]>;
  /** `verify`: the partial flag of each of the survey's responses among `ids` that it holds. */
  responseStates(surveyId: string, ids: readonly string[]): Promise<Map<string, boolean>>;
  /** `verify`: the person's sign-in identities. */
  identitiesOf(
    userId: string,
  ): Promise<{ provider: string; subject: string; email: string | null; emailVerified: boolean }[]>;
  upsertHistory(recs: readonly HistoryRec[]): Promise<void>;
  /** Deletes the survey's history entries beyond the newest `keep` (by `at`, then id); how many. */
  pruneHistory(surveyId: string, keep: number): Promise<number>;
  upsertResponses(recs: readonly ResponseRec[]): Promise<void>;
  upsertMarkers(recs: readonly MarkerRec[]): Promise<void>;
  upsertLayouts(recs: readonly LayoutRec[]): Promise<void>;
  /** The survey's layouts of these kinds (the source has none of them any more); how many. */
  deleteLayouts(surveyId: string, kinds: readonly LayoutKind[]): Promise<number>;
  upsertViews(recs: readonly ViewRec[]): Promise<void>;
  /** The project, its members replaced as a set. */
  upsertProject(rec: ProjectRec, members: readonly MemberRec[]): Promise<void>;
  /** `users` and `user_identities`. */
  upsertPeople(recs: readonly PersonRec[]): Promise<{ skipped: { id: string; reason: string }[] }>;
  /** The users' legacy access keys; a user's other keys are removed. */
  upsertKeys(recs: readonly KeyRec[]): Promise<void>;
  /** The bytes, then the `files` row (and the `legacy_files` name). */
  upsertFile(rec: FileRec): Promise<void>;
  upsertEvents(recs: readonly EventRec[]): Promise<void>;
  upsertDeleted(recs: readonly DeletedRec[]): Promise<void>;
  /**
   * The survey and what hangs on it: its rows, deleted-response copies and Studio's own files
   * (bytes first). Its events stay: the old service keeps a deleted survey's events too.
   */
  deleteSurvey(surveyId: string): Promise<boolean>;
  deleteResponses(surveyId: string, ids: readonly string[]): Promise<number>;
  deleteProject(id: string): Promise<boolean>;
  deletePeople(ids: readonly string[]): Promise<number>;
  /** Saved views by key (`{surveyId}/{userId}/{view}`); how many went. */
  deleteViews(keys: readonly string[]): Promise<number>;
  /** Studio's own files by id, bytes first; never a legacy file (the zero survey). How many. */
  deleteFiles(ids: readonly string[]): Promise<number>;
  /** The survey's completion markers of these client ids; how many went. */
  deleteMarkers(surveyId: string, clientIds: readonly string[]): Promise<number>;
  readonly state: MigrationState;
  /** Releases nothing the caller opened: the database and the byte store stay the caller's. */
  close(): Promise<void>;
}

/** The tables `verify` counts rows of (`MigrationTarget.countRows`, `existingKeys`). */
export type CountedTable =
  | "survey_responses"
  | "survey_layouts"
  | "completion_markers"
  | "saved_views"
  | "survey_events"
  | "deleted_responses"
  | "files"
  | "legacy_files";

/** The key of a counted table's row, as SQL (constant text: never a value). */
const ROW_KEY: Record<CountedTable, string> = {
  survey_responses: "id",
  survey_layouts: "survey_id || '/' || kind",
  completion_markers: "client_id",
  saved_views: "survey_id || '/' || user_id || '/' || view",
  survey_events: "id",
  deleted_responses: "response_id",
  files: "id",
  legacy_files: "kind || '/' || legacy_name",
};
const ZERO_SURVEY = "00000000-0000-0000-0000-000000000000";

/** Rows per statement: under SQLite's and PostgreSQL's parameter limits. */
const BATCH = 200;

/** The id of a row: a GUID, or an error naming the field (never the value's neighbours). */
function guid(value: string, what: string): string {
  if (!GUID.test(value)) throw new Error(`${what} is not a GUID`);
  return value.toLowerCase();
}

/** The records in batches of at most BATCH. */
function* batches<T>(items: readonly T[]): Generator<T[]> {
  for (let start = 0; start < items.length; start += BATCH) yield items.slice(start, start + BATCH);
}

/** The items with one per key, the last one winning (one statement may not name a row twice). */
function distinct<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [keyOf(item), item])).values()];
}

/**
 * JSON text as PostgreSQL's jsonb takes it (U+0000 and a lone surrogate become U+FFFD), on both
 * dialects, so a copy reads the same on either.
 */
const json = (value: unknown): string => jsonText("postgres", value);

export function openMigrationTarget(database: SqlDatabase, bytes: ByteStore): MigrationTarget {
  const { db, dialect } = database;

  const inTransaction = <T>(work: (trx: Kysely<DatabaseSchema>) => Promise<T>): Promise<T> =>
    db.transaction().execute(work);

  return {
    state: createMigrationState(db, dialect),

    async upsertSurvey({ record, definition, theme, privateQuestions }) {
      const id = guid(record.id, "A survey id");
      const columns = columnsOf(record);
      const definitionText = json(definition);
      const themeText = json(theme);
      const values = {
        ...columns,
        definition: definitionText,
        // The version of what is stored, as the app computes it from the text it reads back.
        definition_version: versionOf(JSON.parse(definitionText) as Record<string, unknown>),
        theme: themeText,
        theme_version: versionOf(JSON.parse(themeText) as Record<string, unknown>),
      };
      await inTransaction(async (trx) => {
        await trx
          .insertInto("surveys")
          .values({ id, ...values })
          .onConflict((oc) => oc.column("id").doUpdateSet(values))
          .execute();
        if (privateQuestions.length === 0) {
          await trx.deleteFrom("private_questions").where("survey_id", "=", id).execute();
        } else {
          const names = json(privateQuestions);
          await trx
            .insertInto("private_questions")
            .values({ survey_id: id, names })
            .onConflict((oc) => oc.column("survey_id").doUpdateSet({ names }))
            .execute();
        }
      });
    },

    async privateQuestionsOf(surveyId) {
      const row = await db
        .selectFrom("private_questions")
        .select("names")
        .where("survey_id", "=", guid(surveyId, "A survey id"))
        .executeTakeFirst();
      return row ? jsonOf<string[]>(row.names) : [];
    },

    async idsOf(table) {
      const rows = await db.selectFrom(table).select("id").orderBy("id").execute();
      return rows.map((row) => row.id);
    },

    async countRows(table, surveyId) {
      const scope = countScope(table, surveyId);
      const { rows } = await sql<{ n: number | string }>`
        select count(*) as n from ${sql.table(table)} where ${scope}`.execute(db);
      return Number(rows[0]?.n ?? 0);
    },

    async keysOf(table, surveyId) {
      const key = sql.raw(ROW_KEY[table]);
      const scope = countScope(table, surveyId);
      const { rows } = await sql<{ k: string }>`
        select ${key} as k from ${sql.table(table)} where ${scope}`.execute(db);
      return rows.map((row) => String(row.k)).sort();
    },

    async historyAuthors() {
      const rows = await db
        .selectFrom("survey_history")
        .select("user_id")
        .distinct()
        .where("user_id", "is not", null)
        .execute();
      return rows.map((row) => String(row.user_id)).sort();
    },

    async surveyOwners() {
      const rows = await db
        .selectFrom("surveys")
        .select(["id", "owner_user_id", "owner_project_id"])
        .execute();
      return new Map(
        rows.map((row): [string, SurveyOwner] => [
          row.id,
          row.owner_user_id !== null
            ? { kind: "personal", userId: row.owner_user_id }
            : { kind: "project", projectId: String(row.owner_project_id) },
        ]),
      );
    },

    async seededPeople() {
      const own = sql`i.provider = 'surveyjs' and i.subject = cast(u.id as text)`;
      const { rows } = await sql<{ id: string }>`
        select u.id as id from users u
        where u.instance_role = 'user' and u.password_hash is null and u.last_sign_in_at is null
          and exists (select 1 from user_identities i where i.user_id = u.id and ${own})
          and not exists (
            select 1 from user_identities i where i.user_id = u.id and not (${own}))`.execute(db);
      return rows.map((row) => String(row.id)).sort();
    },

    async projectMembers() {
      const rows = await db
        .selectFrom("project_members")
        .select(["project_id", "user_id", "role"])
        .orderBy("project_id")
        .orderBy("user_id")
        .execute();
      return rows.map((row) => ({
        projectId: row.project_id,
        userId: row.user_id,
        role: row.role,
      }));
    },

    async existingKeys(table, keys, surveyId) {
      const key = sql.raw(ROW_KEY[table]);
      const scope =
        surveyId === undefined || table === "legacy_files"
          ? sql`1 = 1`
          : sql`survey_id = ${guid(surveyId, "A survey id")}`;
      const found = new Set<string>();
      for (const batch of batches([...new Set(keys)])) {
        const { rows } = await sql<{ k: string }>`
          select ${key} as k from ${sql.table(table)}
          where ${scope} and ${key} in (${sql.join(batch)})`.execute(db);
        for (const row of rows) found.add(row.k);
      }
      return [...found];
    },

    async responseStates(surveyId, ids) {
      const id = guid(surveyId, "A survey id");
      const states = new Map<string, boolean>();
      for (const batch of batches([...new Set(ids.map((one) => one.toLowerCase()))])) {
        const rows = await db
          .selectFrom("survey_responses")
          .select(["id", "partial"])
          .where("survey_id", "=", id)
          .where("id", "in", batch)
          .execute();
        for (const row of rows) states.set(row.id, flagOf(row.partial));
      }
      return states;
    },

    async identitiesOf(userId) {
      const rows = await db
        .selectFrom("user_identities")
        .select(["provider", "subject", "email", "email_verified"])
        .where("user_id", "=", guid(userId, "A user id"))
        .orderBy("provider")
        .orderBy("subject")
        .execute();
      return rows.map((row) => ({
        provider: row.provider,
        subject: row.subject,
        email: row.email,
        emailVerified: flagOf(row.email_verified),
      }));
    },

    async upsertHistory(recs) {
      const rows = distinct(
        recs.map((rec) => ({
          survey_id: guid(rec.surveyId, "A survey id"),
          id: guid(rec.id, "A history entry id"),
          at: isoOf(rec.at),
          user_id: rec.userId === null ? null : guid(rec.userId, "A user id"),
          snapshot: json(rec.snapshot),
        })),
        (row) => `${row.survey_id}/${row.id}`,
      );
      for (const batch of batches(rows)) {
        await db
          .insertInto("survey_history")
          .values(batch)
          .onConflict((oc) =>
            oc.columns(["survey_id", "id"]).doUpdateSet((eb) => ({
              at: eb.ref("excluded.at"),
              user_id: eb.ref("excluded.user_id"),
              snapshot: eb.ref("excluded.snapshot"),
            })),
          )
          .execute();
      }
    },

    async pruneHistory(surveyId, keep) {
      const survey = guid(surveyId, "A survey id");
      // The newest entries in the order the app lists history: at descending, then id descending.
      const result = await db
        .deleteFrom("survey_history")
        .where("survey_id", "=", survey)
        .where(
          "id",
          "not in",
          db
            .selectFrom("survey_history")
            .select("id")
            .where("survey_id", "=", survey)
            .orderBy("at", "desc")
            .orderBy("id", "desc")
            .limit(keep),
        )
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },

    async upsertResponses(recs) {
      const rows = distinct(
        recs.map(({ surveyId, response }) => ({
          survey_id: guid(surveyId, "A survey id"),
          id: guid(response.id, "A response id"),
          submitted_at: isoOf(response.submittedAt),
          data: json(response.data),
          client_id: response.clientId ?? null,
          respondent_ip: response.respondentIp ?? null,
          partial: response.partial,
        })),
        (row) => `${row.survey_id}/${row.id}`,
      );
      for (const batch of batches(rows)) {
        await db
          .insertInto("survey_responses")
          .values(batch)
          .onConflict((oc) =>
            oc.columns(["survey_id", "id"]).doUpdateSet((eb) => ({
              submitted_at: eb.ref("excluded.submitted_at"),
              data: eb.ref("excluded.data"),
              client_id: eb.ref("excluded.client_id"),
              respondent_ip: eb.ref("excluded.respondent_ip"),
              partial: eb.ref("excluded.partial"),
            })),
          )
          .execute();
      }
    },

    async upsertMarkers(recs) {
      const rows = distinct(
        recs.map((rec) => ({
          survey_id: guid(rec.surveyId, "A survey id"),
          client_id: rec.clientId,
          partial: rec.partial,
        })),
        (row) => `${row.survey_id}/${row.client_id}`,
      );
      for (const batch of batches(rows)) {
        await db
          .insertInto("completion_markers")
          .values(batch)
          .onConflict((oc) =>
            oc
              .columns(["survey_id", "client_id"])
              .doUpdateSet((eb) => ({ partial: eb.ref("excluded.partial") })),
          )
          .execute();
      }
    },

    async upsertLayouts(recs) {
      const rows = distinct(
        recs.map((rec) => ({
          survey_id: guid(rec.surveyId, "A survey id"),
          kind: rec.kind,
          text: rec.text,
        })),
        (row) => `${row.survey_id}/${row.kind}`,
      );
      for (const batch of batches(rows)) {
        await db
          .insertInto("survey_layouts")
          .values(batch)
          .onConflict((oc) =>
            oc
              .columns(["survey_id", "kind"])
              .doUpdateSet((eb) => ({ text: eb.ref("excluded.text") })),
          )
          .execute();
      }
    },

    async deleteLayouts(surveyId, kinds) {
      if (kinds.length === 0) return 0;
      const result = await db
        .deleteFrom("survey_layouts")
        .where("survey_id", "=", guid(surveyId, "A survey id"))
        .where("kind", "in", [...kinds])
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },

    async upsertViews(recs) {
      const rows = distinct(
        recs.map((rec) => ({
          survey_id: guid(rec.surveyId, "A survey id"),
          user_id: guid(rec.userId, "A user id"),
          view: rec.view,
          state: rec.state === null ? null : json(rec.state),
          updated_at: isoOf(rec.updatedAt),
        })),
        (row) => `${row.survey_id}/${row.user_id}/${row.view}`,
      );
      for (const batch of batches(rows)) {
        await db
          .insertInto("saved_views")
          .values(batch)
          .onConflict((oc) =>
            oc.columns(["survey_id", "user_id", "view"]).doUpdateSet((eb) => ({
              state: eb.ref("excluded.state"),
              updated_at: eb.ref("excluded.updated_at"),
            })),
          )
          .execute();
      }
    },

    async upsertProject(rec, members) {
      const id = guid(rec.id, "A project id");
      const values = {
        name: rec.name,
        creator_id: rec.creatorId === null ? null : guid(rec.creatorId, "A user id"),
        created_at: isoOf(rec.createdAt),
      };
      const rows = distinct(
        members.map((member) => ({
          project_id: guid(member.projectId, "A project id"),
          user_id: guid(member.userId, "A user id"),
          role: member.role,
          created_at: isoOf(member.createdAt),
          updated_at: isoOf(member.updatedAt),
        })),
        (row) => row.user_id,
      );
      if (rows.some((row) => row.project_id !== id)) {
        throw new Error("A member names another project");
      }
      await inTransaction(async (trx) => {
        await trx
          .insertInto("projects")
          .values({ id, ...values })
          .onConflict((oc) => oc.column("id").doUpdateSet(values))
          .execute();
        await trx.deleteFrom("project_members").where("project_id", "=", id).execute();
        for (const batch of batches(rows)) {
          await trx.insertInto("project_members").values(batch).execute();
        }
      });
    },

    async upsertPeople(recs) {
      const incoming = distinct(
        recs.map((rec) => ({
          id: guid(rec.id, "A user id"),
          email: rec.email.toLowerCase(),
          displayName: rec.displayName,
          siteBlocked: rec.siteBlocked,
          createdAt: isoOf(rec.createdAt),
        })),
        (person) => person.id,
      );
      const skipped: { id: string; reason: string }[] = [];
      await inTransaction(async (trx) => {
        // An identity linked to another account stays where it is: that person is not written.
        const linkedElsewhere = new Set<string>();
        for (const batch of batches(incoming.map((person) => person.id))) {
          const rows = await trx
            .selectFrom("user_identities")
            .select(["subject", "user_id"])
            .where("provider", "=", "surveyjs")
            .where("subject", "in", batch)
            .execute();
          for (const row of rows) if (row.user_id !== row.subject) linkedElsewhere.add(row.subject);
        }
        let people = incoming.filter((person) => {
          if (!linkedElsewhere.has(person.id)) return true;
          skipped.push({ id: person.id, reason: "identity-linked-elsewhere" });
          return false;
        });
        // One email, one person: the first of two in the call keeps it.
        const claimed = new Set<string>();
        people = people.filter((person) => {
          if (!claimed.has(person.email)) {
            claimed.add(person.email);
            return true;
          }
          skipped.push({ id: person.id, reason: "email-taken" });
          return false;
        });
        // The current holders of the incoming emails.
        const holders = new Map<string, string>();
        for (const batch of batches(people.map((person) => person.email))) {
          const rows = await trx
            .selectFrom("users")
            .select(["id", "email"])
            .where("email", "in", batch)
            .execute();
          for (const row of rows) holders.set(row.email, row.id);
        }
        // A holder outside the call keeps its email, and the incoming person is not written;
        // dropping one person can leave another's holder outside the call, so repeat until stable.
        for (let changed = true; changed;) {
          changed = false;
          const inCall = new Set(people.map((person) => person.id));
          people = people.filter((person) => {
            const holder = holders.get(person.email);
            if (holder === undefined || inCall.has(holder)) return true;
            skipped.push({ id: person.id, reason: "email-taken" });
            changed = true;
            return false;
          });
        }
        const parked = [
          ...new Set(
            people.flatMap((person) => {
              const holder = holders.get(person.email);
              return holder !== undefined && holder !== person.id ? [holder] : [];
            }),
          ),
        ];
        // Phase one: a holder in the call gives its email up for a temporary one, so the final
        // values can be written in any order. Phase two below sets every final value.
        for (const id of parked) {
          await trx
            .updateTable("users")
            .set({ email: `parked-${id}@parked.example` })
            .where("id", "=", id)
            .execute();
        }
        for (const batch of batches(people)) {
          await trx
            .insertInto("users")
            .values(
              batch.map((person) => ({
                id: person.id,
                email: person.email,
                display_name: person.displayName,
                instance_role: "user" as const,
                status: "active" as const,
                password_hash: null,
                must_change_password: false,
                site_blocked: person.siteBlocked,
                licence_expires_at: null,
                session_epoch: 0,
                created_at: person.createdAt,
                last_sign_in_at: null,
              })),
            )
            // What the old service owns: the email, the name and the block. Role, status,
            // password, sessions and the creation time are Studio's once the row exists.
            .onConflict((oc) =>
              oc.column("id").doUpdateSet((eb) => ({
                email: eb.ref("excluded.email"),
                display_name: eb.ref("excluded.display_name"),
                site_blocked: eb.ref("excluded.site_blocked"),
              })),
            )
            .execute();
          await trx
            .insertInto("user_identities")
            .values(
              batch.map((person) => ({
                provider: "surveyjs" as const,
                subject: person.id,
                user_id: person.id,
                email: person.email,
                email_verified: true,
                created_at: person.createdAt,
              })),
            )
            // Only the email follows; the account the identity belongs to is not moved.
            .onConflict((oc) =>
              oc
                .columns(["provider", "subject"])
                .doUpdateSet((eb) => ({ email: eb.ref("excluded.email") })),
            )
            .execute();
        }
      });
      return { skipped };
    },

    async upsertKeys(recs) {
      const rows = distinct(
        recs.map((rec) => ({
          key_hash: rec.keyHash,
          user_id: guid(rec.userId, "A user id"),
          last_four: rec.lastFour,
          created_at: isoOf(rec.createdAt),
          revoked_at: null,
        })),
        (row) => row.key_hash,
      );
      await inTransaction(async (trx) => {
        for (const row of rows) {
          // A user has one key: an earlier one of the same user goes (as the seed replaces it).
          await trx
            .deleteFrom("legacy_access_keys")
            .where("user_id", "=", row.user_id)
            .where("key_hash", "!=", row.key_hash)
            .execute();
        }
        for (const batch of batches(rows)) {
          await trx
            .insertInto("legacy_access_keys")
            .values(batch)
            .onConflict((oc) =>
              oc.column("key_hash").doUpdateSet((eb) => ({
                user_id: eb.ref("excluded.user_id"),
                last_four: eb.ref("excluded.last_four"),
                created_at: eb.ref("excluded.created_at"),
              })),
            )
            .execute();
        }
      });
    },

    async upsertFile({ kind, legacyName, record, content }) {
      const id = record.id;
      const surveyId = guid(record.surveyId, "A survey id");
      // The bytes first: a row never names bytes that are not there (the key fixes them, so a
      // second run replaces the same bytes).
      await bytes.put(`${surveyId}/${id}`, content, record.contentType);
      const values = {
        survey_id: surveyId,
        owner_user_id: null,
        kind,
        name: record.name,
        content_type: record.contentType,
        size: record.size,
        created_at: isoOf(record.createdAt),
      };
      await inTransaction(async (trx) => {
        await trx
          .insertInto("files")
          .values({ id, ...values })
          .onConflict((oc) => oc.column("id").doUpdateSet(values))
          .execute();
        if (legacyName !== null) {
          await trx
            .insertInto("legacy_files")
            .values({ kind, legacy_name: legacyName, file_id: id })
            .onConflict((oc) => oc.columns(["kind", "legacy_name"]).doUpdateSet({ file_id: id }))
            .execute();
        }
      });
    },

    async upsertEvents(recs) {
      const rows = distinct(
        recs.map((rec) => ({
          id: guid(rec.id, "An event id"),
          survey_id: guid(rec.surveyId, "A survey id"),
          type: rec.type,
          at: isoOf(rec.at),
          payload: rec.payload,
        })),
        (row) => row.id,
      );
      for (const batch of batches(rows)) {
        await db
          .insertInto("survey_events")
          .values(batch)
          .onConflict((oc) =>
            oc.column("id").doUpdateSet((eb) => ({
              survey_id: eb.ref("excluded.survey_id"),
              type: eb.ref("excluded.type"),
              at: eb.ref("excluded.at"),
              payload: eb.ref("excluded.payload"),
            })),
          )
          .execute();
      }
    },

    async upsertDeleted(recs) {
      const rows = distinct(
        recs.map((rec) => ({
          survey_id: guid(rec.surveyId, "A survey id"),
          response_id: guid(rec.responseId, "A response id"),
          deleted_at: isoOf(rec.deletedAt),
          response: rec.response,
        })),
        (row) => `${row.survey_id}/${row.response_id}`,
      );
      for (const batch of batches(rows)) {
        await db
          .insertInto("deleted_responses")
          .values(batch)
          .onConflict((oc) =>
            oc.columns(["survey_id", "response_id"]).doUpdateSet((eb) => ({
              deleted_at: eb.ref("excluded.deleted_at"),
              response: eb.ref("excluded.response"),
            })),
          )
          .execute();
      }
    },

    async deleteSurvey(surveyId) {
      const id = guid(surveyId, "A survey id");
      // Studio's own files first, bytes before rows: a stop in between leaves rows a retry finds.
      const files = await db.selectFrom("files").select("id").where("survey_id", "=", id).execute();
      await bytes.delete(files.map((file) => `${id}/${file.id}`));
      return inTransaction(async (trx) => {
        // The tables without a foreign key that hold what the copy wrote for the survey.
        await trx.deleteFrom("files").where("survey_id", "=", id).execute();
        await trx.deleteFrom("deleted_responses").where("survey_id", "=", id).execute();
        return deleteSurveyRows(trx, id);
      });
    },

    async deleteResponses(surveyId, ids) {
      const survey = guid(surveyId, "A survey id");
      const wanted = ids.map((id) => guid(id, "A response id"));
      let deleted = 0;
      for (const batch of batches(wanted)) {
        const result = await db
          .deleteFrom("survey_responses")
          .where("survey_id", "=", survey)
          .where("id", "in", batch)
          .executeTakeFirst();
        deleted += Number(result.numDeletedRows);
      }
      return deleted;
    },

    async deleteProject(id) {
      // The members go with it (cascade).
      const result = await db
        .deleteFrom("projects")
        .where("id", "=", guid(id, "A project id"))
        .executeTakeFirst();
      return result.numDeletedRows > 0n;
    },

    async deletePeople(ids) {
      const wanted = ids.map((id) => guid(id, "A user id"));
      let deleted = 0;
      for (const batch of batches(wanted)) {
        await db.deleteFrom("legacy_access_keys").where("user_id", "in", batch).execute();
        // Their identities go with them (cascade).
        const result = await db.deleteFrom("users").where("id", "in", batch).executeTakeFirst();
        deleted += Number(result.numDeletedRows);
      }
      return deleted;
    },

    async deleteViews(keys) {
      let deleted = 0;
      await inTransaction(async (trx) => {
        for (const key of new Set(keys)) {
          const [surveyId = "", userId = "", view = ""] = key.split("/");
          if (view !== "summary" && view !== "table") continue;
          const result = await trx
            .deleteFrom("saved_views")
            .where("survey_id", "=", guid(surveyId, "A survey id"))
            .where("user_id", "=", guid(userId, "A user id"))
            .where("view", "=", view)
            .executeTakeFirst();
          deleted += Number(result.numDeletedRows);
        }
      });
      return deleted;
    },

    async deleteFiles(ids) {
      let deleted = 0;
      for (const batch of batches([...new Set(ids.map((id) => id.toLowerCase()))])) {
        const rows = await db
          .selectFrom("files")
          .select(["id", "survey_id"])
          .where("id", "in", batch)
          .where("survey_id", "is not", null)
          .where("survey_id", "<>", ZERO_SURVEY)
          .execute();
        if (rows.length === 0) continue;
        // The bytes first: when they cannot be deleted the rows stay, so a retry finds them.
        await bytes.delete(rows.map((row) => `${String(row.survey_id)}/${row.id}`));
        const own = rows.map((row) => row.id);
        const result = await db.deleteFrom("files").where("id", "in", own).executeTakeFirst();
        deleted += Number(result.numDeletedRows);
      }
      return deleted;
    },

    async deleteMarkers(surveyId, clientIds) {
      const survey = guid(surveyId, "A survey id");
      let deleted = 0;
      for (const batch of batches([...new Set(clientIds)])) {
        const result = await db
          .deleteFrom("completion_markers")
          .where("survey_id", "=", survey)
          .where("client_id", "in", batch)
          .executeTakeFirst();
        deleted += Number(result.numDeletedRows);
      }
      return deleted;
    },

    close: () => Promise.resolve(),
  };
}

/**
 * The rows `countRows` and `keysOf` read: the survey's when given; `files` without a survey are
 * Studio's own (not the old service's of the zero survey); `legacy_files` have no survey.
 */
function countScope(table: CountedTable, surveyId: string | undefined) {
  if (table === "files" && surveyId === undefined) {
    return sql`survey_id is not null and survey_id <> ${ZERO_SURVEY}`;
  }
  return surveyId === undefined || table === "legacy_files"
    ? sql`1 = 1`
    : sql`survey_id = ${guid(surveyId, "A survey id")}`;
}
