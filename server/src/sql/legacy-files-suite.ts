import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalByteStore } from "../bytes/local.js";
import { newFileId } from "../domain/file-id.js";
import type { FileKind, SurveyFileRecord } from "../domain/types.js";
import type { FileStore } from "../providers/types.js";
import { openDatabase, type SqlDatabase, type SqlDialectName } from "./database.js";
import { createSqlFileStore } from "./file-store.js";
import { migrate } from "./migrator.js";
import { scratchDatabase, type ScratchDatabase } from "./scratch-databases.js";

const CONTENT = Buffer.from("a legacy file's bytes");

/** What `legacy_files` must do beyond the provider suite: names that follow their file. */
export function describeSqlLegacyFilesSuite(dialect: SqlDialectName): void {
  describe(`SQL legacy file names: ${dialect}`, () => {
    let scratch: ScratchDatabase;
    let database: SqlDatabase;
    let root: string;
    let store: FileStore;
    beforeAll(async () => {
      scratch = await scratchDatabase(dialect);
      database = openDatabase(scratch.target);
      await migrate(database);
      root = mkdtempSync(join(tmpdir(), "surveyjs-studio-legacy-files-"));
      store = createSqlFileStore(database, createLocalByteStore(root));
    });
    afterAll(async () => {
      await database.close();
      await scratch.drop();
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    });

    /** A stored file of a new survey, named `name` in `legacy_files` as `kind`. */
    async function named(kind: FileKind, name: string): Promise<SurveyFileRecord> {
      const surveyId = randomUUID();
      const file: SurveyFileRecord = {
        id: newFileId(surveyId),
        surveyId,
        kind,
        name: "stored name.bin",
        contentType: "application/octet-stream",
        size: CONTENT.length,
        createdAt: "2026-11-01T10:00:00.000Z",
      };
      await store.putFile(file, CONTENT);
      await database.db
        .insertInto("legacy_files")
        .values({ kind, legacy_name: name, file_id: file.id })
        .execute();
      return file;
    }

    const namesOf = (fileId: string) =>
      database.db.selectFrom("legacy_files").selectAll().where("file_id", "=", fileId).execute();

    it("serves the file under its legacy name and type, and drops the name with the file", async () => {
      const name = `${randomUUID()}.PDF`;
      const file = await named("response", name);
      const found = await store.getFileByLegacyName("response", name);
      expect(found?.file).toEqual({ ...file, name, contentType: "application/pdf" });
      const chunks: Buffer[] = [];
      for await (const chunk of found!.content) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks)).toStrictEqual(CONTENT);

      expect(await store.deleteFile(file.id)).toBe(true);
      expect(await namesOf(file.id)).toEqual([]);
      expect(await store.getFileByLegacyName("response", name)).toBeNull();
    });

    it("drops the names of a survey's files deleted together", async () => {
      const file = await named("asset", randomUUID());
      expect(await namesOf(file.id)).toHaveLength(1);
      expect(await store.deleteSurveyFiles(file.surveyId)).toBe(1);
      expect(await namesOf(file.id)).toEqual([]);
    });
  });
}
