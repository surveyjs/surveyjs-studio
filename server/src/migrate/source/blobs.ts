import { BlobServiceClient, type BlobProperties, type ContainerClient } from "@azure/storage-blob";
import type { HistoryEntryRecord, LayoutKind } from "../../domain/types.js";
import { LegacyStoreError, statusOf } from "../../providers/azure-legacy/errors.js";
import {
  historyEntryFromBlob,
  isGuid,
  LAYOUT_CONTAINERS_BY_KIND,
} from "../../providers/azure-legacy/mapping.js";
import { historyOrder } from "../../providers/ordering.js";
import { dateHeader } from "./tables.js";

/** The legacy blob containers of the surveys account, read only. */
export interface BlobSource {
  definitionText(surveyId: string): Promise<string | null>;
  /**
   * The survey's history entries from the listing alone (no snapshot read), newest first; with
   * the survey's publish id, its published snapshot among them, as `historyNewest` counts it.
   */
  historyEntries(surveyId: string, publishId?: string | null): Promise<HistoryEntryRecord[]>;
  /**
   * The survey's `keep` newest history entries with their snapshots, newest first. With the
   * survey's publish id, its published snapshot counts among them as `publishedSnapshot` reads it.
   */
  historyNewest(
    surveyId: string,
    keep: number,
    publishId?: string | null,
  ): Promise<{ entry: HistoryEntryRecord; text: string }[]>;
  /**
   * The published snapshot `surveypublishedjson/{publishId}` as a history entry: the publish id,
   * the blob's last-modified time, no user (mapping 3.4). Null when there is none or the publish
   * id is not a GUID.
   */
  publishedSnapshot(
    publishId: string | null | undefined,
  ): Promise<{ entry: HistoryEntryRecord; text: string } | null>;
  layoutText(surveyId: string, kind: LayoutKind): Promise<string | null>;
  permissionsText(surveyId: string): Promise<string | null>;
  views(): AsyncIterable<{
    surveyId: string;
    userId: string;
    view: "summary" | "table";
    text: string;
    lastModified: Date;
  }>;
  /** One saved view blob (`{surveyId}/{userId}/{view}`) with its time; null when it is gone. */
  viewBlob(blobName: string): Promise<{ text: string; lastModified: Date } | null>;
  /** The names of a layout kind's blobs (survey ids as stored; a listing of a small container). */
  layoutNames(kind: LayoutKind): AsyncIterable<string>;
  /** The names of the container's blobs changed after `since` (a listing; small containers). */
  changedBlobs(
    container: "layouts" | "permissions" | "views" | "published",
    since: Date,
  ): AsyncIterable<string>;
  appFiles(): AsyncIterable<{
    blobName: string;
    properties: BlobProperties;
    metadata: Record<string, string>;
  }>;
  /** The bytes of a blob `appFiles` listed; null when it is gone. */
  appFile(blobName: string): Promise<Buffer | null>;
  /** The surveys account's clock (its blobs' change times are stamped by it); null: none. */
  blobsClock(): Promise<Date | null>;
}

const HISTORY_CONTAINER = "surveyjsonhistory";
const PUBLISHED_CONTAINER = "surveypublishedjson";
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

  /** The bytes of a blob; null when the blob or its container is missing. */
  async function bytesOf(operation: string, from: string, name: string): Promise<Buffer | null> {
    try {
      return await container(from).getBlobClient(name).downloadToBuffer();
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw new LegacyStoreError(operation, error);
    }
  }

  /** The text of a blob; null when the blob or its container is missing. */
  async function textOf(operation: string, from: string, name: string): Promise<string | null> {
    return (await bytesOf(operation, from, name))?.toString("utf8") ?? null;
  }

  /**
   * The survey's history entries with their blobs, newest first; with a publish id, its published
   * snapshot among them (unless a point of the survey has the same id).
   */
  async function historyOf(
    surveyId: string,
    publishId?: string | null,
  ): Promise<{ entry: HistoryEntryRecord; from: string; name: string }[]> {
    const id = surveyId.toLowerCase();
    const entries: { entry: HistoryEntryRecord; from: string; name: string }[] = [];
    for await (const blob of blobsOf("history list", HISTORY_CONTAINER, `${id}/`)) {
      const entry = historyEntryFromBlob(
        id,
        blob.name,
        blob.metadata,
        blob.properties.lastModified,
      );
      if (entry) entries.push({ entry, from: HISTORY_CONTAINER, name: blob.name });
    }
    const published = await publishedEntry(publishId);
    if (published && !entries.some(({ entry }) => entry.id === published.entry.id)) {
      entries.push(published);
    }
    return entries.sort((a, b) => historyOrder(a.entry, b.entry));
  }

  /** The published snapshot's entry and blob (its time only, no text read); null: none. */
  async function publishedEntry(
    publishId: string | null | undefined,
  ): Promise<{ entry: HistoryEntryRecord; from: string; name: string } | null> {
    if (!publishId || !isGuid(publishId)) return null;
    // Named by the publish id in lower case, as the old service names its survey blobs.
    const name = publishId.toLowerCase();
    try {
      const { lastModified } = await container(PUBLISHED_CONTAINER)
        .getBlobClient(name)
        .getProperties();
      if (!lastModified) return null;
      return {
        entry: { id: name, at: lastModified.toISOString(), userId: null },
        from: PUBLISHED_CONTAINER,
        name,
      };
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw new LegacyStoreError("published snapshot read", error);
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

    historyEntries: async (surveyId, publishId) =>
      (await historyOf(surveyId, publishId)).map(({ entry }) => entry),

    async historyNewest(surveyId, keep, publishId) {
      const entries = await historyOf(surveyId, publishId);
      const newest: { entry: HistoryEntryRecord; text: string }[] = [];
      for (const { entry, from, name } of entries.slice(0, Math.max(0, keep))) {
        const text = await textOf("history read", from, name);
        if (text !== null) newest.push({ entry, text });
      }
      return newest;
    },

    async publishedSnapshot(publishId) {
      const published = await publishedEntry(publishId);
      if (published === null) return null;
      const text = await textOf("published snapshot read", PUBLISHED_CONTAINER, published.name);
      return text === null ? null : { entry: published.entry, text };
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

    async viewBlob(blobName) {
      try {
        const blob = container(VIEWS_CONTAINER).getBlobClient(blobName);
        const { lastModified } = await blob.getProperties();
        const text = (await blob.downloadToBuffer()).toString("utf8");
        return lastModified ? { text, lastModified } : null;
      } catch (error) {
        if (statusOf(error) === 404) return null;
        throw new LegacyStoreError("view read", error);
      }
    },

    async *layoutNames(kind) {
      for await (const blob of blobsOf("layout list", LAYOUT_CONTAINERS_BY_KIND[kind])) {
        yield blob.name;
      }
    },

    async *changedBlobs(from, since) {
      const containers =
        from === "layouts"
          ? layoutContainers
          : from === "permissions"
            ? [PERMISSIONS_CONTAINER]
            : from === "published"
              ? [PUBLISHED_CONTAINER]
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

    appFile: (blobName) => bytesOf("file read", FILES_CONTAINER, blobName),

    async blobsClock() {
      // Any answer carries the service's time, a refusal or a missing container's included.
      try {
        return (await container("surveyjson").getProperties()).date ?? null;
      } catch (error) {
        return dateHeader(
          (error as { response?: { headers?: { get(name: string): string | undefined } } }).response
            ?.headers,
        );
      }
    },
  };
}
