import type { components } from "@my-surveys/contract";
import type { RequestUser } from "../auth/authenticate.js";
import { publicUrl } from "../auth/identity.js";
import type { Clock } from "../auth/session.js";
import { newFileId } from "../domain/file-id.js";
import type { StoredFileRecord } from "../domain/types.js";
import { AppError } from "../errors.js";
import type { Directory, FileStore, StoredFileContent, SurveyStore } from "../providers/types.js";
import { createSurveyAccess, notFound } from "../surveys/access.js";
import { ALLOWED_TYPES_TEXT, detectFileType, fileNameOf } from "./file-type.js";
import { formatBytes, remainingQuota } from "./quota.js";

export type StoredFileJson = components["schemas"]["StoredFile"];

export interface FilesServiceOptions {
  readonly surveys: SurveyStore;
  readonly directory: Directory;
  readonly files: FileStore;
  /** The origin the `url` of a stored file starts with. */
  readonly publicBaseUrl: string;
  /** Total bytes of assets one survey may hold (R5). */
  readonly maxAssetBytesPerSurvey: number;
  /** The clock for creation times; default `Date.now`. */
  readonly now?: Clock;
}

/** The first file part of an upload. */
export interface IncomingFile {
  readonly fieldName: string;
  readonly fileName: string | undefined;
  readonly bytes: Buffer;
}

export interface FilesService {
  /**
   * R13 order. `read(maxBytes)` reads the request's first file part (undefined when there is none); the
   * handler's implementation turns multipart errors into AppErrors: file over `maxBytes` → 413
   * quota-exceeded, a malformed or cut body → 400 bad-request.
   */
  uploadAsset(
    user: RequestUser,
    surveyId: string,
    read: (maxBytes: number) => Promise<IncomingFile | undefined>,
  ): Promise<StoredFileJson>;
  /** 404 not-found for an unknown or malformed id. */
  download(fileId: string): Promise<StoredFileContent>;
}

/** The field an upload sends its file in. */
export const FILE_FIELD = "file";

/** The path of a stored file under the API root (the `Location` of an upload). */
export const filePath = (id: string): string => `/api/v1/public/files/${id}`;

/** 413: the survey's file quota is used up (R14). */
export function quotaExceeded(quota: number): AppError {
  return new AppError({
    code: "quota-exceeded",
    status: 413,
    title: "File quota exceeded",
    detail: `This survey can store up to ${formatBytes(quota)} of files.`,
  });
}

const invalidFile = (detail: string): AppError =>
  new AppError({
    code: "validation-failed",
    status: 422,
    title: "Validation failed",
    errors: [{ pointer: `/${FILE_FIELD}`, detail }],
  });

const unsupportedType = (): AppError =>
  new AppError({
    code: "unsupported-media-type",
    status: 415,
    title: "Unsupported file type",
    detail: ALLOWED_TYPES_TEXT,
  });

/** Editor uploads and public downloads of stored files. */
export function createFilesService(options: FilesServiceOptions): FilesService {
  const { surveys, directory, files, publicBaseUrl, now = Date.now } = options;
  const quota = options.maxAssetBytesPerSurvey;
  const access = createSurveyAccess({ surveys, directory });

  return {
    async uploadAsset(user, surveyId, read) {
      const { survey } = await access.modifiable(user, surveyId);
      const remaining = remainingQuota(quota, await files.usage(survey.id, "asset"));
      if (remaining <= 0) throw quotaExceeded(quota);

      const incoming = await read(remaining);
      if (incoming?.fieldName !== FILE_FIELD) {
        throw invalidFile("Send one file in the part named file.");
      }
      const { bytes } = incoming;
      if (bytes.length === 0) throw invalidFile("The file is empty.");
      const type = detectFileType(bytes);
      if (!type) throw unsupportedType();

      const record: StoredFileRecord = {
        id: newFileId(survey.id),
        surveyId: survey.id.toLowerCase(),
        kind: "asset",
        name: fileNameOf(incoming.fileName),
        contentType: type.contentType,
        size: bytes.length,
        createdAt: new Date(now()).toISOString(),
      };
      await files.putFile(record, bytes);
      // Concurrent uploads may each have passed the first check: the total decides (R5).
      if ((await files.usage(survey.id, "asset")) > quota) {
        await files.deleteFile(record.id);
        throw quotaExceeded(quota);
      }
      return {
        id: record.id,
        url: publicUrl(publicBaseUrl, filePath(record.id)),
        name: record.name,
        contentType: record.contentType,
        size: record.size,
      };
    },

    async download(fileId) {
      const found = await files.getFile(fileId);
      if (!found) throw notFound();
      return found;
    },
  };
}
