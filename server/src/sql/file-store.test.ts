import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalByteStore } from "../bytes/local.js";
import type { ByteStore } from "../bytes/types.js";
import { newFileId } from "../domain/file-id.js";
import type { StoredFileRecord } from "../domain/types.js";
import { openDatabase, type SqlDatabase } from "./database.js";
import { createSqlFileStore } from "./file-store.js";
import { migrate } from "./migrator.js";
import { scratchSqlite } from "./scratch-databases.js";

const CONTENT = Buffer.from("respondent's file");

const fileOf = (surveyId: string): StoredFileRecord => ({
  id: newFileId(surveyId),
  surveyId,
  kind: "response",
  name: "answer.txt",
  contentType: "text/plain",
  size: CONTENT.length,
  createdAt: "2026-10-29T10:00:00.000Z",
});

describe("SQL file store, failures and races", () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  /** A migrated database, a folder of bytes, and that folder's store to wrap. */
  async function setup(): Promise<{ database: SqlDatabase; local: ByteStore }> {
    const scratch = scratchSqlite();
    const root = mkdtempSync(join(tmpdir(), "surveyjs-studio-files-"));
    const database = openDatabase(scratch.target);
    cleanups.push(() => scratch.drop());
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    cleanups.push(() => database.close());
    await migrate(database);
    return { database, local: createLocalByteStore(root) };
  }

  it("removes the bytes of an upload whose survey's files were deleted while it was written", async () => {
    const { database, local } = await setup();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const slow: ByteStore = {
      ...local,
      put: async (key, content, type) => {
        await held;
        await local.put(key, content, type);
      },
    };
    const files = createSqlFileStore(database, slow);
    const survey = randomUUID();
    const file = fileOf(survey);
    const upload = files.putFile(file, CONTENT);
    // The survey goes (or its results, or the account) while the bytes are on their way.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await files.deleteSurveyFiles(survey)).toBe(1);
    release();
    await expect(upload).rejects.toThrow("was deleted while it was stored");
    expect(await local.get(`${survey}/${file.id}`)).toBeNull();
    expect(await files.getFile(file.id)).toBeNull();
  });

  it("keeps the rows when the bytes cannot be deleted, so a second delete finishes the job", async () => {
    const { database, local } = await setup();
    let failing = true;
    const flaky: ByteStore = {
      ...local,
      delete: async (keys) => {
        if (failing) throw new Error("S3 is unreachable");
        await local.delete(keys);
      },
    };
    const files = createSqlFileStore(database, flaky);
    const survey = randomUUID();
    const one = fileOf(survey);
    const two = fileOf(survey);
    await files.putFile(one, CONTENT);
    await files.putFile(two, CONTENT);

    await expect(files.deleteFile(one.id)).rejects.toThrow("S3 is unreachable");
    await expect(files.deleteSurveyFiles(survey)).rejects.toThrow("S3 is unreachable");
    expect(await files.usage(survey, "response")).toBe(2 * CONTENT.length);

    failing = false;
    expect(await files.deleteFile(one.id)).toBe(true);
    expect(await files.deleteSurveyFiles(survey)).toBe(1);
    expect(await local.get(`${survey}/${one.id}`)).toBeNull();
    expect(await local.get(`${survey}/${two.id}`)).toBeNull();
    expect(await files.usage(survey, "response")).toBe(0);
  });

  it("removes a new file's row when its bytes cannot be stored", async () => {
    const { database, local } = await setup();
    const broken: ByteStore = { ...local, put: () => Promise.reject(new Error("disk full")) };
    const files = createSqlFileStore(database, broken);
    const file = fileOf(randomUUID());
    await expect(files.putFile(file, CONTENT)).rejects.toThrow("disk full");
    expect(await files.usage(file.surveyId, "response")).toBe(0);
  });

  it("leaves neither rows nor bytes of a copy that fails part-way", async () => {
    const { database, local } = await setup();
    let copies = 0;
    const breaksOnSecond: ByteStore = {
      ...local,
      copy: async (from, to) => {
        copies += 1;
        if (copies === 2) throw new Error("copy failed");
        await local.copy(from, to);
      },
    };
    const files = createSqlFileStore(database, breaksOnSecond);
    const from = randomUUID();
    const to = randomUUID();
    for (let i = 0; i < 3; i++) await files.putFile({ ...fileOf(from), kind: "asset" }, CONTENT);
    await expect(files.copySurveyAssets(from, to, "2026-10-29T11:00:00.000Z")).rejects.toThrow(
      "copy failed",
    );
    expect(await files.usage(to, "asset")).toBe(0);
    expect(await files.deleteSurveyFiles(to)).toBe(0);
  });
});
