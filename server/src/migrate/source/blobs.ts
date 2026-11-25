import { BlobServiceClient, type BlobProperties, type ContainerClient } from "@azure/storage-blob";
import type { HistoryEntryRecord, LayoutKind } from "../../domain/types.js";
import { LegacyStoreError, statusOf } from "../../providers/azure-legacy/errors.js";
import {
  historyEntryFromBlob,
  LAYOUT_CONTAINERS_BY_KIND,
} from "../../providers/azure-legacy/mapping.js";
import { historyOrder } from "../../providers/ordering.js";

/** The legacy blob containers of the surveys account, read only. */
export interface BlobSource {
  definitionText(surveyId: string): Promise<string | null>;
  historyNewest(
    surveyId: string,
    keep: number,
  ): Promise<{ entry: HistoryEntryRecord; text: string }[]>;
  layoutText(surveyId: string, kind: LayoutKind): Promise<string | null>;
  permissionsText(surveyId: string): Promise<string | null>;
  views(): AsyncIterable<{
    surveyId: string;
    userId: string;
    view: "summary" | "table";
    text: string;
    lastModified: Date;
  }>;
  changedBlobs(container: "layouts" | "permissions" | "views", since: Date): AsyncIterable<string>;
  appFiles(): AsyncIterable<{
    blobName: string;
    properties: BlobProperties;
    metadata: Record<string, string>;
  }>;
}

const PERMISSIONS_CONTAINER = "surveyresultpermissions";
const VIEWS_CONTAINER = "my-surveys-views";
const FILES_CONTAINER = "my-surveys-files";

export function openBlobSource(connectionString: string): BlobSource {
  let service: BlobServiceClient;
  try {
    service = BlobServiceClient.fromConnectionString(connectionString);
  } catch {
    throw new Error(
      "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING is not a valid Azure Storage connection string",
    );
  }
  const container = (name: string): ContainerClient => service.getContainerClient(name);

  /** The text of a blob; null when the blob or its container is missing. */
  async function textOf(operation: string, from: string, name: string): Promise<string | null> {
    try {
      const bytes = await container(from).getBlobClient(name).downloadToBuffer();
      return bytes.toString("utf8");
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw new LegacyStoreError(operation, error);
    }
  }

  /** Every blob of a container with the given options; a missing container is empty. */
  async function* blobsOf(operation: string, from: string, prefix?: string) {
    try {
      yield* container(from).listBlobsFlat({
        includeMetadata: true,
        ...(prefix !== undefined && { prefix }),
      });
    } catch (error) {
      if (statusOf(error) === 404) return;
      throw new LegacyStoreError(operation, error);
    }
  }

  const layoutContainers = Object.values(LAYOUT_CONTAINERS_BY_KIND);

  return {
    async definitionText(surveyId) {
      const id = surveyId.toLowerCase();
      const text = await textOf("definition read", "surveyjson", id);
      // An empty surveyjson is a save that failed after replacing it: the text is in surveytext.
      return text === "" ? await textOf("definition read", "surveytext", id) : text;
    },

    async historyNewest(surveyId, keep) {
      const id = surveyId.toLowerCase();
      const entries: { entry: HistoryEntryRecord; name: string }[] = [];
      for await (const blob of blobsOf("history list", "surveyjsonhistory", `${id}/`)) {
        const entry = historyEntryFromBlob(
          id,
          blob.name,
          blob.metadata,
          blob.properties.lastModified,
        );
        if (entry) entries.push({ entry, name: blob.name });
      }
      entries.sort((a, b) => historyOrder(a.entry, b.entry));
      const newest: { entry: HistoryEntryRecord; text: string }[] = [];
      for (const { entry, name } of entries.slice(0, Math.max(0, keep))) {
        const text = await textOf("history read", "surveyjsonhistory", name);
        if (text !== null) newest.push({ entry, text });
      }
      return newest;
    },

    layoutText: (surveyId, kind) =>
      textOf("layout read", LAYOUT_CONTAINERS_BY_KIND[kind], surveyId.toLowerCase()),

    permissionsText: (surveyId) =>
      textOf("public questions read", PERMISSIONS_CONTAINER, surveyId.toLowerCase()),

    async *views() {
      for await (const blob of blobsOf("view list", VIEWS_CONTAINER)) {
        const [surveyId, userId, view, ...rest] = blob.name.split("/");
        if (!surveyId || !userId || rest.length > 0) continue;
        if (view !== "summary" && view !== "table") continue;
        // A zero-byte blob is a reset marker: its text is empty.
        const text = await textOf("view read", VIEWS_CONTAINER, blob.name);
        if (text === null) continue;
        yield { surveyId, userId, view, text, lastModified: blob.properties.lastModified };
      }
    },

    async *changedBlobs(from, since) {
      const containers =
        from === "layouts"
          ? layoutContainers
          : from === "permissions"
            ? [PERMISSIONS_CONTAINER]
            : [VIEWS_CONTAINER];
      const seen = new Set<string>();
      for (const name of containers) {
        for await (const blob of blobsOf("changed blob list", name)) {
          if (blob.properties.lastModified.getTime() <= since.getTime()) continue;
          if (seen.has(blob.name)) continue;
          seen.add(blob.name);
          yield blob.name;
        }
      }
    },

    async *appFiles() {
      for await (const blob of blobsOf("file list", FILES_CONTAINER)) {
        yield { blobName: blob.name, properties: blob.properties, metadata: blob.metadata ?? {} };
      }
    },
  };
}
