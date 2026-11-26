import { TableServiceClient } from "@azure/data-tables";
import { BlobServiceClient } from "@azure/storage-blob";
import { ShareServiceClient } from "@azure/storage-file-share";
import type { LegacyConfig } from "../../config.js";
import { isLocalStorageString } from "../../legacy/endpoint-guard.js";
import { statusOf } from "../../providers/azure-legacy/errors.js";
import type { LegacyShare } from "../../providers/azure-legacy/legacy-shares.js";
import { safeErrorParts } from "../../safe-error.js";
import { Refused } from "../state.js";
import { CONTAINERS_EVERY_SOURCE_HOLDS } from "./blobs.js";
import { sourceFingerprint } from "./fingerprint.js";
import type { ListingShareReader } from "./shares.js";
import { EVENTS_TABLE, tableClient } from "./tables.js";

const SURVEYS = "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING";
const RESULTS = "LEGACY_RESULTS_STORAGE_CONNECTION_STRING";

/** A store the connection string gives the SDK no way to reach; the message says why. */
class Unusable extends Error {}

/** Why a probe failed, in words free of hosts and secrets (statuses and codes only). */
function why(error: unknown): string {
  if (error instanceof Unusable) return error.message;
  const status = statusOf(error);
  if (status === 404) return "it does not exist";
  if (status === 401 || status === 403) return `access refused (${String(status)})`;
  const parts = safeErrorParts(error);
  return parts.length > 0 ? `cannot be read (${parts.join(", ")})` : "cannot be reached";
}

/** One probe: null when it answered, else the problem. */
async function problemOf(name: string, probe: () => Promise<unknown>): Promise<string | null> {
  try {
    await probe();
    return null;
  } catch (error) {
    return `${name}: ${why(error)}`;
  }
}

const refusal = (problems: readonly string[]) =>
  new Refused(`the source cannot be read: ${problems.join("; ")}`);

/**
 * Checks, before anything is written, that every store the tool reads answers: the two file
 * shares (of a remote source; Azurite has no file service, and a share reader given by the caller
 * is taken as it is), the containers and the event table every source holds, and the results
 * account's table list; and, of a remote source, that the two storage settings name two accounts.
 * Throws a `Refused` naming each one that does not. Without this a share the credentials cannot
 * read would read as "no file" and a missing container as "empty": the copy would take nothing,
 * `verify` would agree, and `reconcile` would remove what the copy took.
 */
export async function probeLegacySource(
  legacy: LegacyConfig,
  options: { shares?: ListingShareReader | null } = {},
): Promise<void> {
  // The old service keeps the responses in an account of their own; the local replica has one.
  const { surveysAccount, resultsAccount } = sourceFingerprint(legacy);
  const remote = [
    legacy.surveysStorageConnectionString,
    legacy.resultsStorageConnectionString,
  ].some((connectionString) => !isLocalStorageString(connectionString));
  if (remote && surveysAccount !== "" && surveysAccount === resultsAccount) {
    throw refusal([`${SURVEYS} and ${RESULTS} name the same storage account`]);
  }
  if (options.shares === undefined) {
    const shares: [LegacyShare, string, string][] = [
      ["surveyfiles", SURVEYS, legacy.surveysStorageConnectionString],
      ["files", RESULTS, legacy.resultsStorageConnectionString],
    ];
    const problems: string[] = [];
    for (const [share, setting, connectionString] of shares) {
      if (isLocalStorageString(connectionString)) continue;
      const problem = await problemOf(`the file share ${share} (${setting})`, async () => {
        let root;
        try {
          root =
            ShareServiceClient.fromConnectionString(connectionString).getShareClient(
              share,
            ).rootDirectoryClient;
        } catch {
          // A read-only SAS without a file endpoint, say.
          throw new Unusable("the connection string gives no file service the tool can use");
        }
        return root.listFilesAndDirectories().byPage({ maxPageSize: 1 }).next();
      });
      if (problem !== null) problems.push(problem);
    }
    // Before the other stores: a share problem is found without the network.
    if (problems.length > 0) throw refusal(problems);
  }

  const problems: (string | null)[] = [];
  for (const name of CONTAINERS_EVERY_SOURCE_HOLDS) {
    problems.push(
      await problemOf(`the container ${name} (${SURVEYS})`, () =>
        BlobServiceClient.fromConnectionString(legacy.surveysStorageConnectionString)
          .getContainerClient(name)
          .getProperties(),
      ),
    );
  }
  problems.push(
    await problemOf(`the table ${EVENTS_TABLE} (${SURVEYS})`, () =>
      tableClient(legacy.surveysStorageConnectionString, EVENTS_TABLE)
        .listEntities({ queryOptions: { select: ["RowKey"] } })
        .byPage({ maxPageSize: 1 })
        .next(),
    ),
  );
  problems.push(
    await problemOf(`the table list (${RESULTS})`, () => {
      const tables = TableServiceClient.fromConnectionString(
        legacy.resultsStorageConnectionString,
        {
          allowInsecureConnection: isLocalStorageString(legacy.resultsStorageConnectionString),
        },
      ).listTables();
      return tables[Symbol.asyncIterator]().next();
    }),
  );
  const found = problems.filter((problem): problem is string => problem !== null);
  if (found.length > 0) throw refusal(found);
}

/**
 * Checks, once the source is open, that the results account is the old app's: a survey that has
 * had a response has a `post…` table there. A wrong account that exists answers every survey's
 * table with "not found", which reads as "no responses": the copy would take none and `verify`
 * would agree. Throws a `Refused` when the account lists no such table while the SQL source
 * holds a survey (only its first page of surveys is read).
 */
export async function probeResultsAccount(source: {
  resultTables(): Promise<Set<string>>;
  surveys(): AsyncIterable<unknown>;
}): Promise<void> {
  const tables = await source.resultTables();
  if ([...tables].some((name) => /^post/i.test(name))) return;
  const surveys = source.surveys()[Symbol.asyncIterator]();
  const first = await surveys.next();
  await surveys.return?.();
  if (first.done !== true) {
    throw refusal([
      `the results account (${RESULTS}) holds no response table while the SQL source holds surveys`,
    ]);
  }
}
