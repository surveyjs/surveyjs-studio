import { Readable } from "node:stream";
import { FILE_ID_PATTERN, newFileId, surveyIdOfFile } from "../domain/file-id.js";
import { isLegacyFileName, legacyFileRecord } from "../domain/legacy-file.js";
import type { FileKind, StoredFileRecord } from "../domain/types.js";
import type { FileStore } from "./types.js";

/** A file stored under the old service's name (the seed's `legacyFiles`). */
export interface MemoryLegacyFile {
  readonly kind: FileKind;
  readonly name: string;
  readonly content: Buffer;
}

interface Stored {
  readonly file: StoredFileRecord;
  readonly bytes: Buffer;
}

/** Files in process memory, like all memory data; the legacy files are the seed's, read only. */
export function createMemoryFileStore(legacyFiles: readonly MemoryLegacyFile[] = []): FileStore {
  const files = new Map<string, Stored>();
  const legacyKey = (kind: FileKind, name: string): string => `${kind}/${name}`;
  const legacy = new Map(
    legacyFiles.map((f) => [legacyKey(f.kind, f.name), Buffer.from(f.content)] as const),
  );

  const put = (file: StoredFileRecord, content: Buffer): void => {
    if (!FILE_ID_PATTERN.test(file.id) || surveyIdOfFile(file.id) !== file.surveyId) {
      throw new Error("The file id does not belong to the file's survey");
    }
    if (content.length !== file.size) throw new Error("The file size does not match its content");
    if (files.has(file.id)) throw new Error("A file with this id exists");
    files.set(file.id, { file: { ...file }, bytes: Buffer.from(content) });
  };

  const ofSurvey = (surveyId: string): Stored[] =>
    [...files.values()].filter((s) => s.file.surveyId === surveyId.toLowerCase());

  return {
    putFile: (file, content) => {
      try {
        put(file, content);
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error as Error);
      }
    },
    getFile: (id) => {
      const found = files.get(id.toLowerCase());
      return Promise.resolve(
        found
          ? { file: { ...found.file }, content: Readable.from(Buffer.from(found.bytes)) }
          : null,
      );
    },
    usage: (surveyId, kind: FileKind) =>
      Promise.resolve(
        ofSurvey(surveyId)
          .filter((s) => s.file.kind === kind)
          .reduce((sum, s) => sum + s.file.size, 0),
      ),
    deleteFile: (id) => Promise.resolve(files.delete(id.toLowerCase())),
    deleteSurveyFiles: (surveyId, kind) => {
      const found = ofSurvey(surveyId).filter((s) => kind === undefined || s.file.kind === kind);
      for (const s of found) files.delete(s.file.id);
      return Promise.resolve(found.length);
    },
    copySurveyAssets: (fromSurveyId, toSurveyId, copiedAt) => {
      const copied = new Map<string, string>();
      for (const s of ofSurvey(fromSurveyId).filter((x) => x.file.kind === "asset")) {
        const id = newFileId(toSurveyId);
        files.set(id, {
          file: { ...s.file, id, surveyId: toSurveyId.toLowerCase(), createdAt: copiedAt },
          bytes: Buffer.from(s.bytes),
        });
        copied.set(s.file.id, id);
      }
      return Promise.resolve(copied);
    },
    getFileByLegacyName: (kind, name) => {
      const bytes = isLegacyFileName(name) ? legacy.get(legacyKey(kind, name)) : undefined;
      return Promise.resolve(
        bytes
          ? {
              file: legacyFileRecord(kind, name, bytes.length),
              content: Readable.from(Buffer.from(bytes)),
            }
          : null,
      );
    },
  };
}
