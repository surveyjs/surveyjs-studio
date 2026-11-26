import type { LegacyConfig } from "../../config.js";
import { openBlobSource, type BlobSource } from "./blobs.js";
import { openShareSource, type ListingShareReader, type ShareSource } from "./shares.js";
import { openSqlSource, type SqlSource } from "./sql.js";
import { openTableSource, type TableSource } from "./tables.js";

/**
 * The legacy stores as the migration tool reads them: SQL rows, table entities, blobs and share
 * files, in the shapes of the Azure legacy provider's own rows. Read only (ESLint enforces it for
 * this folder). Ids come back as stored; the mapping lower-cases them.
 */
export interface LegacySource extends SqlSource, TableSource, BlobSource, ShareSource {}

export type { BlobSource, ShareSource, SqlSource, TableSource };

export function openLegacySource(
  legacy: LegacyConfig,
  options: { shares?: ListingShareReader | null; warn?: (message: string) => void } = {},
): LegacySource {
  const sql = openSqlSource(legacy.sqlConnectionString);
  const tables = openTableSource(legacy);
  const blobs = openBlobSource(legacy.surveysStorageConnectionString);
  const shares = openShareSource(legacy, options.shares, options.warn);
  // Spread, not wrapped calls: the readers hold no `this`, and a wrapper calling
  // `deletedCopies` would trip the read-only lint rule (a method named delete…).
  return { ...sql, ...tables, ...blobs, ...shares, close: () => sql.close() };
}
