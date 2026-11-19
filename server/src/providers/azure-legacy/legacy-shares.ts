import { ShareServiceClient } from "@azure/storage-file-share";
import type { LegacyConfig } from "../../config.js";
import { isLegacyFileName } from "../../domain/legacy-file.js";
import { isLocalStorageString } from "../../legacy/endpoint-guard.js";
import { LegacyStoreError, statusOf } from "./errors.js";

/**
 * The legacy file shares (layout section 9.5), read only: `surveyfiles` of the surveys account
 * holds the editor images, `files` of the results account the respondent uploads. Both keep their
 * files in the root directory. Nothing here writes (ESLint enforces it for the folder).
 */
export type LegacyShare = "surveyfiles" | "files";

export interface LegacyShareReader {
  /**
   * The bytes of the file `name` in the share's root directory, as stored; null when there is no
   * file with exactly this name (case included) or the name is no legacy file name. Rejects with
   * a LegacyStoreError on any other failure.
   */
  read(share: LegacyShare, name: string): Promise<Buffer | null>;
}

/** The part of the SDK's directory client the reader uses (a test fakes it). */
export interface ShareRoot {
  listFilesAndDirectories(options: { prefix: string }): {
    byPage(settings: { maxPageSize: number }): AsyncIterator<{
      segment: { fileItems: readonly { name: string }[] };
    }>;
  };
  getFileClient(name: string): { downloadToBuffer(): Promise<Buffer> };
}

/**
 * The listing that checks a name's case reads at most this many pages of this many entries. The
 * share's names are GUIDs (with an extension for respondent files), so few names start with
 * another one; a name not found in them reads as unknown.
 */
const CASE_CHECK_PAGE = 100;
const CASE_CHECK_PAGES = 10;

/**
 * A reader over the given share roots; a share without a root holds nothing. Azure Files matches
 * names without regard to case, so a name is first looked up in a listing of the names that start
 * with it and must be there exactly; only then are its bytes read.
 */
export function shareReaderOf(roots: Partial<Record<LegacyShare, ShareRoot>>): LegacyShareReader {
  return {
    async read(share, name) {
      const root = roots[share];
      if (!root || !isLegacyFileName(name)) return null;
      try {
        const pages = root
          .listFilesAndDirectories({ prefix: name })
          .byPage({ maxPageSize: CASE_CHECK_PAGE });
        let listed = false;
        for (let read = 0; read < CASE_CHECK_PAGES && !listed; read++) {
          const page = await pages.next();
          if (page.done === true) break;
          listed = page.value.segment.fileItems.some((item) => item.name === name);
        }
        if (!listed) return null;
        return await root.getFileClient(name).downloadToBuffer();
      } catch (error) {
        // The share itself is missing, or the file went between the listing and the read.
        if (statusOf(error) === 404) return null;
        throw new LegacyStoreError("legacy file read", error);
      }
    },
  };
}

/** Pino-compatible warning sink. */
interface WarningLogger {
  warn(details: Readonly<Record<string, string>>, message: string): void;
}

/**
 * The reader over the legacy accounts' file shares, with the provider's own connection strings.
 * A string for the local emulator (Azurite has no file service), or one the file SDK cannot use,
 * gives that account's share no root: its files read as unknown. Null when neither share has one.
 * Connection strings are secrets: the warning names the setting only.
 */
export function createLegacyShareReader(
  legacy: Pick<LegacyConfig, "surveysStorageConnectionString" | "resultsStorageConnectionString">,
  logger: WarningLogger,
): LegacyShareReader | null {
  const rootOf = (variable: string, share: LegacyShare, connectionString: string) => {
    if (isLocalStorageString(connectionString)) return undefined;
    try {
      return ShareServiceClient.fromConnectionString(connectionString).getShareClient(share)
        .rootDirectoryClient;
    } catch {
      logger.warn(
        { setting: variable, share },
        "The legacy file share cannot be read with this connection string: its files answer 404.",
      );
      return undefined;
    }
  };
  const roots: Partial<Record<LegacyShare, ShareRoot>> = {};
  const surveyfiles = rootOf(
    "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
    "surveyfiles",
    legacy.surveysStorageConnectionString,
  );
  if (surveyfiles) roots.surveyfiles = surveyfiles;
  const files = rootOf(
    "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
    "files",
    legacy.resultsStorageConnectionString,
  );
  if (files) roots.files = files;
  return Object.keys(roots).length === 0 ? null : shareReaderOf(roots);
}
