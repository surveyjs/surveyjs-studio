import type { Selectable } from "kysely";
import type { ByteStore } from "../bytes/types.js";
import { FILE_ID_PATTERN, newFileId, surveyIdOfFile } from "../domain/file-id.js";
import { GUID } from "../domain/guid.js";
import type { StoredFileRecord } from "../domain/types.js";
import type { FileStore } from "../providers/types.js";
import type { SqlDatabase } from "./database.js";
import type { FilesTable } from "./schema.js";
import { isoOf } from "./values.js";

const keyOf = (file: { id: string; surveyId: string }): string => `${file.surveyId}/${file.id}`;

const recordOf = (row: Selectable<FilesTable>): StoredFileRecord => ({
  id: row.id,
  surveyId: row.survey_id,
  kind: row.kind,
  name: row.name,
  contentType: row.content_type,
  size: Number(row.size),
  createdAt: isoOf(row.created_at),
});

/**
 * The file store of the SQL providers (docs/architecture/data-model.md): the metadata in the
 * `files` table, the bytes in `bytes` (FILE_STORE) under `{survey id}/{file id}`. A new file's
 * row is written first (a second file with its id is refused before any byte is written) and
 * removed again when its bytes cannot be stored; a deleted file's row goes first, then its bytes.
 */
export function createSqlFileStore(database: SqlDatabase, bytes: ByteStore): FileStore {
  const { db } = database;

  const rowsOf = (surveyId: string, kind?: StoredFileRecord["kind"]) => {
    let query = db.selectFrom("files").selectAll().where("survey_id", "=", surveyId.toLowerCase());
    if (kind !== undefined) query = query.where("kind", "=", kind);
    return query.execute();
  };

  return {
    putFile: async (file, content) => {
      if (!FILE_ID_PATTERN.test(file.id) || surveyIdOfFile(file.id) !== file.surveyId) {
        throw new Error("The file id does not belong to the file's survey");
      }
      if (content.length !== file.size) throw new Error("The file size does not match its content");
      await db
        .insertInto("files")
        .values({
          id: file.id,
          survey_id: file.surveyId,
          kind: file.kind,
          name: file.name,
          content_type: file.contentType,
          size: file.size,
          created_at: isoOf(file.createdAt),
        })
        .execute();
      try {
        await bytes.put(keyOf(file), content, file.contentType);
      } catch (error) {
        await db.deleteFrom("files").where("id", "=", file.id).execute();
        throw error;
      }
    },
    getFile: async (id) => {
      const fileId = id.toLowerCase();
      if (!FILE_ID_PATTERN.test(fileId)) return null;
      const row = await db
        .selectFrom("files")
        .selectAll()
        .where("id", "=", fileId)
        .executeTakeFirst();
      if (!row) return null;
      const file = recordOf(row);
      const content = await bytes.get(keyOf(file));
      return content === null ? null : { file, content };
    },
    usage: async (surveyId, kind) => {
      if (!GUID.test(surveyId)) return 0;
      const row = await db
        .selectFrom("files")
        .select((eb) => eb.fn.sum<number | string | bigint | null>("size").as("total"))
        .where("survey_id", "=", surveyId.toLowerCase())
        .where("kind", "=", kind)
        .executeTakeFirstOrThrow();
      return Number(row.total ?? 0);
    },
    deleteFile: async (id) => {
      const fileId = id.toLowerCase();
      if (!FILE_ID_PATTERN.test(fileId)) return false;
      const row = await db
        .deleteFrom("files")
        .where("id", "=", fileId)
        .returning(["id", "survey_id"])
        .executeTakeFirst();
      if (!row) return false;
      await bytes.delete([keyOf({ id: row.id, surveyId: row.survey_id })]);
      return true;
    },
    deleteSurveyFiles: async (surveyId, kind) => {
      if (!GUID.test(surveyId)) return 0;
      let query = db.deleteFrom("files").where("survey_id", "=", surveyId.toLowerCase());
      if (kind !== undefined) query = query.where("kind", "=", kind);
      const rows = await query.returning(["id", "survey_id"]).execute();
      await bytes.delete(rows.map((row) => keyOf({ id: row.id, surveyId: row.survey_id })));
      return rows.length;
    },
    copySurveyAssets: async (fromSurveyId, toSurveyId, copiedAt) => {
      const sources = GUID.test(fromSurveyId) ? await rowsOf(fromSurveyId, "asset") : [];
      const toSurvey = toSurveyId.toLowerCase();
      const copies = sources.map((row) => ({ row, id: newFileId(toSurvey) }));
      const copied: string[] = [];
      try {
        for (const { row, id } of copies) {
          const key = keyOf({ id, surveyId: toSurvey });
          await bytes.copy(keyOf({ id: row.id, surveyId: row.survey_id }), key);
          copied.push(key);
        }
        if (copies.length > 0) {
          await db
            .insertInto("files")
            .values(
              copies.map(({ row, id }) => ({
                id,
                survey_id: toSurvey,
                kind: "asset" as const,
                name: row.name,
                content_type: row.content_type,
                size: Number(row.size),
                created_at: isoOf(copiedAt),
              })),
            )
            .execute();
        }
      } catch (error) {
        // Nothing of a failed copy stays: the rows are one statement, the bytes are removed.
        await bytes.delete(copied).catch(() => undefined);
        throw error;
      }
      return new Map(copies.map(({ row, id }) => [row.id, id]));
    },
  };
}
