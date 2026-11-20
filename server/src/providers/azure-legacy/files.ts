import { Readable } from "node:stream";
import type { BlobServiceClient } from "@azure/storage-blob";
import { FILE_ID_PATTERN, surveyIdOfFile } from "../../domain/file-id.js";
import { isLegacyFileName, legacyFileRecord } from "../../domain/legacy-file.js";
import type { FileStore } from "../types.js";
import { LegacyStoreError, statusOf } from "./errors.js";
import type { LegacyShareReader } from "./legacy-shares.js";
import { USER_FILES_PREFIX, fileRecordFromBlob, isGuid } from "./mapping.js";
import {
  writeFile,
  writeFileDeletion,
  writeSurveyAssetsCopy,
  writeSurveyFilesDeletion,
  writeUserFile,
  writeUserFilesDeletion,
} from "./writes.js";

/**
 * Editor files in a blob container of the surveys account (Step 7, R2): block blob
 * `{surveyId}/{fileId}` with the type as its content type and metadata `kind`, `name` and
 * `createdat`. Legacy code addresses containers by fixed names only, so it never sees this one;
 * the legacy file shares are never written.
 *
 * A user's editor file of no survey (`saveUserFile`) is block blob `users/{ownerId}/{fileId}` of
 * the same container; its legacy name is its id.
 *
 * Files under the old service's names come from the legacy shares (`shares`): editor images
 * from `surveyfiles`, respondent uploads from `files`. Without a reader every such name is unknown.
 * An asset name is looked up among the users' files first.
 *
 * Reads only here (the folder is read-only by lint); the store's writes call writes.ts.
 */
export function createAzureFileStore(
  blobs: BlobServiceClient,
  options: { readonly container: string; readonly shares: LegacyShareReader | null },
): FileStore {
  const { container, shares } = options;
  const files = () => blobs.getContainerClient(container);

  /** The file of blob `name`; null for an unknown blob or one that is no file. */
  async function readBlob(name: string) {
    let response;
    try {
      response = await files().getBlockBlobClient(name).download();
    } catch (error) {
      // An unknown blob, or no container before the first upload.
      if (statusOf(error) === 404) return null;
      throw new LegacyStoreError("file read", error);
    }
    const body = response.readableStreamBody;
    const file = fileRecordFromBlob(name, response, response.metadata);
    if (!file || !body) {
      if (body instanceof Readable) body.destroy();
      return null;
    }
    return { file, content: body instanceof Readable ? body : Readable.from(body) };
  }

  return {
    putFile: (file, content) => writeFile(blobs, container, file, content),

    async getFile(id) {
      const surveyId = surveyIdOfFile(id);
      if (surveyId === null) return null;
      return readBlob(`${surveyId}/${id.toLowerCase()}`);
    },

    async usage(surveyId, kind) {
      if (!isGuid(surveyId)) return 0;
      let sum = 0;
      try {
        const listing = files().listBlobsFlat({
          prefix: `${surveyId.toLowerCase()}/`,
          includeMetadata: true,
        });
        for await (const blob of listing) {
          if (blob.metadata?.kind === kind) sum += blob.properties.contentLength ?? 0;
        }
      } catch (error) {
        if (statusOf(error) === 404) return 0; // no container before the first upload
        throw new LegacyStoreError("file usage", error);
      }
      return sum;
    },

    deleteFile: (id) => writeFileDeletion(blobs, container, id),

    deleteSurveyFiles: (surveyId, kind) =>
      isGuid(surveyId)
        ? writeSurveyFilesDeletion(blobs, container, surveyId, kind)
        : Promise.resolve(0),

    copySurveyAssets: (fromSurveyId, toSurveyId, copiedAt) =>
      writeSurveyAssetsCopy(blobs, container, fromSurveyId, toSurveyId, copiedAt),

    async getFileByLegacyName(kind, name) {
      // A user's file: its id, lower case, names its owner.
      if (kind === "asset" && FILE_ID_PATTERN.test(name)) {
        const own = await readBlob(`${USER_FILES_PREFIX}${surveyIdOfFile(name)}/${name}`);
        if (own) return { file: { ...own.file, name }, content: own.content };
      }
      if (!shares || !isLegacyFileName(name)) return null;
      const bytes = await shares.read(kind === "asset" ? "surveyfiles" : "files", name);
      return bytes
        ? { file: legacyFileRecord(kind, name, bytes.length), content: Readable.from(bytes) }
        : null;
    },

    saveUserFile: (ownerUserId, file) => writeUserFile(blobs, container, ownerUserId, file),

    deleteUserFiles: (ownerUserId) => writeUserFilesDeletion(blobs, container, ownerUserId),
  };
}
