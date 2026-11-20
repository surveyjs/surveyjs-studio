import type { Selectable } from "kysely";
import type { ByteStore } from "../bytes/types.js";
import { FILE_ID_PATTERN, newFileId, newUserFileId, surveyIdOfFile } from "../domain/file-id.js";
import { GUID } from "../domain/guid.js";
import { isLegacyFileName, legacyContentType } from "../domain/legacy-file.js";
import type { StoredFileRecord } from "../domain/types.js";
import type { FileStore } from "../providers/types.js";
import type { SqlDatabase } from "./database.js";
import type { FilesTable } from "./schema.js";
import { isoOf } from "./values.js";

/** A survey's file: `{survey id}/{file id}`. */
const keyOf = (file: { id: string; surveyId: string }): string => `${file.surveyId}/${file.id}`;

/** A user's file of no survey: `uploads/{file id}` (its owner is in the row only). */
const uploadKeyOf = (id: string): string => `uploads/${id}`;

/** The bytes' key of a row: a survey's file, or a user's file of no survey. */
const keyOfRow = (row: Pick<Selectable<FilesTable>, "id" | "survey_id">) =>
  row.survey_id !== null ? keyOf({ id: row.id, surveyId: row.survey_id }) : uploadKeyOf(row.id);

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
 * `files` table, the bytes in `bytes` (FILE_STORE) under `{survey id}/{file id}`.
 *
 * - A new file's row is written first, so a second file with its id is refused before any byte is
 *   written; the row is removed again when its bytes cannot be stored. Once the bytes are stored
 *   the row is read again: when a delete took it meanwhile (the survey, its results or the
 *   account went), the bytes are deleted too and the upload is refused.
 * - A delete removes the bytes first, then the rows: when the bytes cannot be deleted the rows
 *   stay, so the caller's retry finds them. A row whose bytes are gone reads as no file.
 * - A file under the old service's name is a `files` row named by `legacy_files`; deleting the
 *   file deletes its names (cascade).
 * - An editor file of no survey (`saveUserFile`) is a row with `owner_user_id` instead of
 *   `survey_id` and a random id, named by `legacy_files` (`asset`, its id); its bytes are under
 *   `uploads/{file id}`. The survey operations never see it.
 */
export function createSqlFileStore(database: SqlDatabase, bytes: ByteStore): FileStore {
  const { db } = database;

  /** Reads the bytes of a row; null when they are gone. */
  const contentOf = async (row: Selectable<FilesTable>, file: StoredFileRecord) => {
    const content = await bytes.get(keyOfRow(row));
    return content === null ? null : { file, content };
  };

  const rowsOf = (surveyId: string, kind?: StoredFileRecord["kind"]) => {
    let query = db.selectFrom("files").selectAll().where("survey_id", "=", surveyId.toLowerCase());
    if (kind !== undefined) query = query.where("kind", "=", kind);
    return query.execute();
  };

  return {
    putFile: async (file, content) => {
      const { surveyId } = file;
      if (
        !FILE_ID_PATTERN.test(file.id) ||
        surveyId === null ||
        surveyIdOfFile(file.id) !== surveyId
      ) {
        throw new Error("The file id does not belong to the file's survey");
      }
      if (content.length !== file.size) throw new Error("The file size does not match its content");
      await db
        .insertInto("files")
        .values({
          id: file.id,
          survey_id: surveyId,
          owner_user_id: null,
          kind: file.kind,
          name: file.name,
          content_type: file.contentType,
          size: file.size,
          created_at: isoOf(file.createdAt),
        })
        .execute();
      await storeBytes(file.id, keyOf({ id: file.id, surveyId }), content, file.contentType);
    },
    getFile: async (id) => {
      const fileId = id.toLowerCase();
      if (!FILE_ID_PATTERN.test(fileId)) return null;
      const row = await db
        .selectFrom("files")
        .selectAll()
        .where("id", "=", fileId)
        .where("survey_id", "is not", null)
        .executeTakeFirst();
      return row ? contentOf(row, recordOf(row)) : null;
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
        .selectFrom("files")
        .select(["id", "survey_id"])
        .where("id", "=", fileId)
        .where("survey_id", "is not", null)
        .executeTakeFirst();
      if (!row) return false;
      await bytes.delete([keyOfRow(row)]);
      const deleted = await db.deleteFrom("files").where("id", "=", fileId).executeTakeFirst();
      return deleted.numDeletedRows > 0n;
    },
    deleteSurveyFiles: async (surveyId, kind) => {
      if (!GUID.test(surveyId)) return 0;
      const rows = await rowsOf(surveyId, kind);
      if (rows.length === 0) return 0;
      await bytes.delete(rows.map(keyOfRow));
      const ids = rows.map((row) => row.id);
      const deleted = await db.deleteFrom("files").where("id", "in", ids).executeTakeFirst();
      return Number(deleted.numDeletedRows);
    },
    copySurveyAssets: async (fromSurveyId, toSurveyId, copiedAt) => {
      const sources = GUID.test(fromSurveyId) ? await rowsOf(fromSurveyId, "asset") : [];
      const toSurvey = toSurveyId.toLowerCase();
      const copies = sources.map((row) => ({ row, id: newFileId(toSurvey) }));
      const copied: string[] = [];
      try {
        for (const { row, id } of copies) {
          const key = keyOf({ id, surveyId: toSurvey });
          await bytes.copy(keyOfRow(row), key);
          copied.push(key);
        }
        if (copies.length > 0) {
          await db
            .insertInto("files")
            .values(
              copies.map(({ row, id }) => ({
                id,
                survey_id: toSurvey,
                owner_user_id: null,
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
    getFileByLegacyName: async (kind, name) => {
      if (!isLegacyFileName(name)) return null;
      const row = await db
        .selectFrom("legacy_files")
        .innerJoin("files", "files.id", "legacy_files.file_id")
        .selectAll("files")
        .where("legacy_files.kind", "=", kind)
        .where("legacy_files.legacy_name", "=", name)
        .executeTakeFirst();
      if (!row) return null;
      const file = recordOf(row);
      // A user's file keeps its stored type; the old service's files have their extension's.
      return contentOf(row, {
        ...file,
        kind,
        name,
        contentType: row.survey_id === null ? file.contentType : legacyContentType(name),
      });
    },
    saveUserFile: async (ownerUserId, { name, contentType, createdAt, content }) => {
      if (!GUID.test(ownerUserId)) throw new Error("A file of no survey needs its owner's GUID");
      const owner = ownerUserId.toLowerCase();
      const file: StoredFileRecord = {
        id: newUserFileId(),
        surveyId: null,
        kind: "asset",
        name,
        contentType,
        size: content.length,
        createdAt,
      };
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto("files")
          .values({
            id: file.id,
            survey_id: null,
            owner_user_id: owner,
            kind: "asset",
            name,
            content_type: contentType,
            size: file.size,
            created_at: isoOf(createdAt),
          })
          .execute();
        await trx
          .insertInto("legacy_files")
          .values({ kind: "asset", legacy_name: file.id, file_id: file.id })
          .execute();
      });
      await storeBytes(file.id, uploadKeyOf(file.id), content, contentType);
      return file;
    },
    countUserFiles: async (ownerUserId) => {
      if (!GUID.test(ownerUserId)) return 0;
      const row = await db
        .selectFrom("files")
        .select((eb) => eb.fn.countAll<number | string | bigint>().as("count"))
        .where("owner_user_id", "=", ownerUserId.toLowerCase())
        .executeTakeFirstOrThrow();
      return Number(row.count);
    },
    deleteUserFiles: async (ownerUserId) => {
      if (!GUID.test(ownerUserId)) return 0;
      const rows = await db
        .selectFrom("files")
        .select(["id", "survey_id"])
        .where("owner_user_id", "=", ownerUserId.toLowerCase())
        .execute();
      if (rows.length === 0) return 0;
      // The bytes first: when they cannot be deleted the rows stay, so a retry finds them.
      await bytes.delete(rows.map(keyOfRow));
      const ids = rows.map((row) => row.id);
      const deleted = await db.deleteFrom("files").where("id", "in", ids).executeTakeFirst();
      return Number(deleted.numDeletedRows);
    },
  };

  /**
   * Stores the bytes of the row just written (`id`) under `key`. When they cannot be stored the row
   * is removed again; when a delete took the row meanwhile (the survey, its results or the account
   * went), the bytes are deleted too and it rejects.
   */
  async function storeBytes(
    id: string,
    key: string,
    content: Buffer,
    contentType: string,
  ): Promise<void> {
    try {
      await bytes.put(key, content, contentType);
    } catch (error) {
      await db.deleteFrom("files").where("id", "=", id).execute();
      throw error;
    }
    const kept = await db.selectFrom("files").select("id").where("id", "=", id).executeTakeFirst();
    if (!kept) {
      await bytes.delete([key]);
      throw new Error("The file was deleted while it was stored");
    }
  }
}
