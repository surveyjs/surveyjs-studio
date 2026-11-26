import { ShareServiceClient } from "@azure/storage-file-share";
import type { LegacyConfig } from "../../config.js";
import { isLocalStorageString } from "../../legacy/endpoint-guard.js";
import { LegacyStoreError, statusOf } from "../../providers/azure-legacy/errors.js";
import {
  createLegacyShareReader,
  type LegacyShare,
  type LegacyShareReader,
} from "../../providers/azure-legacy/legacy-shares.js";

/** A share reader that can also name a share's files (the stub of the tests can). */
export type ListingShareReader = LegacyShareReader & {
  list?(share: LegacyShare): AsyncIterable<string>;
};

export interface ShareSource {
  shareFile(share: LegacyShare, name: string): Promise<Buffer | null>;
  /** The file names of a share's root directory; empty when the share cannot be listed. */
  shareFiles(share: LegacyShare): AsyncIterable<string>;
}

/**
 * The legacy file shares, read only. `shares` undefined: the provider's own reader over the
 * connection strings, whose warnings (a share it cannot use) go to `warn`; null: no shares (every
 * file reads as unknown).
 */
export function openShareSource(
  legacy: Pick<LegacyConfig, "surveysStorageConnectionString" | "resultsStorageConnectionString">,
  shares?: ListingShareReader | null,
  warn: (message: string) => void = () => undefined,
): ShareSource {
  const reader: LegacyShareReader | null =
    shares === undefined
      ? createLegacyShareReader(legacy, {
          warn: (details, message) => warn(`${message} ${JSON.stringify(details)}`),
        })
      : shares;

  const connectionStringOf = (share: LegacyShare) =>
    share === "surveyfiles"
      ? legacy.surveysStorageConnectionString
      : legacy.resultsStorageConnectionString;

  return {
    async shareFile(share, name) {
      return reader ? reader.read(share, name) : null;
    },
    async *shareFiles(share) {
      if (shares === null) return;
      if (shares?.list) {
        yield* shares.list(share);
        return;
      }
      const connectionString = connectionStringOf(share);
      if (isLocalStorageString(connectionString)) return;
      try {
        const root =
          ShareServiceClient.fromConnectionString(connectionString).getShareClient(
            share,
          ).rootDirectoryClient;
        for await (const item of root.listFilesAndDirectories()) {
          if (item.kind === "file") yield item.name;
        }
      } catch (error) {
        if (statusOf(error) === 404) return;
        throw new LegacyStoreError("legacy file list", error);
      }
    },
  };
}
