import { Readable } from "node:stream";
import type { BlobServiceClient } from "@azure/storage-blob";
import { surveyIdOfFile } from "../../domain/file-id.js";
import type { FileStore } from "../types.js";
import { LegacyStoreError, statusOf } from "./errors.js";
import { fileRecordFromBlob, isGuid } from "./mapping.js";
import {
  writeFile,
  writeFileDeletion,
  writeSurveyAssetsCopy,
  writeSurveyFilesDeletion,
} from "./writes.js";

/**
 * Editor files in a blob container of the surveys account (Step 7, R2): block blob
 * `{surveyId}/{fileId}` with the type as its content type and metadata `kind`, `name` and
 * `createdat`. Legacy code addresses containers by fixed names only, so it never sees this one;
 * the legacy file share `surveyfiles` is never touched.
 *
 * Reads only here (the folder is read-only by lint); the store's writes call writes.ts.
 */
export function createAzureFileStore(
  blobs: BlobServiceClient,
  options: { readonly container: string },
): FileStore {
  const { container } = options;
  const files = () => blobs.getContainerClient(container);

  return {
    putFile: (file, content) => writeFile(blobs, container, file, content),

    async getFile(id) {
      const surveyId = surveyIdOfFile(id);
      if (surveyId === null) return null;
      const name = `${surveyId}/${id.toLowerCase()}`;
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
  };
}
