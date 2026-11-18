/**
 * Counts and sizes of the legacy stores, for hosted Step 1 (`pnpm inspect:legacy --stats`):
 * the store choice, the window estimate and the scale check rest on them. This file is the
 * pure part (classify, aggregate, format); stats-source.ts reads the stores.
 *
 * The output holds counts and sizes only, never a name, id, email or value from the data,
 * except the names of tables and containers that are not of a known kind. Measured on
 * production it is still private (plan-hosted.md, rule 6).
 */

/** `shared` when both storage connection strings name one account. */
export type StorageAccountName = "surveys" | "results" | "shared";

/** The SQL counts (legacy-data-layout.md §3.1, §3.11–3.13). */
export interface SqlCounts {
  readonly users: number;
  readonly usersWithAccessKey: number;
  readonly blockedUsers: number;
  readonly surveys: number;
  readonly projectSurveys: number;
  readonly archivedSurveys: number;
  readonly surveysWithTheme: number;
  /** DATALENGTH of every `Surveys.theme`. */
  readonly themeBytes: number;
  readonly projects: number;
  readonly memberships: number;
}

export interface TableMeasurement {
  readonly account: StorageAccountName;
  readonly name: string;
  readonly rows: number;
  /** UTF-16 code units of every `result` in the table; null unless `--result-bytes`. */
  readonly resultChars: number | null;
}

export interface ContainerMeasurement {
  readonly account: StorageAccountName;
  readonly name: string;
  readonly blobSizes: readonly number[];
  /** Blobs whose name has no `/`. */
  readonly rootBlobs: number;
  /** Blobs in each top-level folder (`{surveyId}/…`), in no order. */
  readonly blobsPerFolder: readonly number[];
}

export interface StatsMeasurements {
  readonly sql: SqlCounts;
  readonly tables: readonly TableMeasurement[];
  readonly containers: readonly ContainerMeasurement[];
  readonly resultBytesMeasured: boolean;
}

export interface Distribution {
  readonly count: number;
  readonly total: number;
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
  readonly max: number;
}

/** Nearest-rank percentiles; all zeros for no values. */
export function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) return { count: 0, total: 0, p50: 0, p90: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number) => sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
  return {
    count: sorted.length,
    total: sorted.reduce((sum, value) => sum + value, 0),
    p50: rank(50),
    p90: rank(90),
    p99: rank(99),
    max: sorted[sorted.length - 1]!,
  };
}

export type TableKind =
  "responses" | "deletedResponses" | "completionMarkers" | "surveyEvents" | "other";

const HEX32 = "[0-9a-f]{32}";
const TABLE_PATTERNS: readonly [RegExp, TableKind][] = [
  [new RegExp(`^postdelete${HEX32}$`, "i"), "deletedResponses"],
  [new RegExp(`^post${HEX32}$`, "i"), "responses"],
  [new RegExp(`^SurveyCompletion${HEX32}$`, "i"), "completionMarkers"],
  [/^surveys$/, "surveyEvents"],
];

/**
 * The kind of a table (legacy-data-layout.md §3.5–3.8), by its name only: the two storage
 * connection strings may name one account (§2.3).
 */
export function classifyTable(name: string): TableKind {
  return TABLE_PATTERNS.find(([pattern]) => pattern.test(name))?.[1] ?? "other";
}

/** Folds a container's blob listing into counts; keeps sizes, not names. */
export function measureContainer(
  account: StorageAccountName,
  name: string,
  blobs: Iterable<{ readonly name: string; readonly bytes: number }>,
): ContainerMeasurement {
  const blobSizes: number[] = [];
  const folders = new Map<string, number>();
  let rootBlobs = 0;
  for (const blob of blobs) {
    blobSizes.push(blob.bytes);
    const slash = blob.name.indexOf("/");
    if (slash < 0) rootBlobs += 1;
    else {
      const folder = blob.name.slice(0, slash);
      folders.set(folder, (folders.get(folder) ?? 0) + 1);
    }
  }
  return { account, name, blobSizes, rootBlobs, blobsPerFolder: [...folders.values()] };
}

export interface TableGroupSummary {
  readonly tables: number;
  /** Rows per table. */
  readonly rows: Distribution;
  readonly resultChars: { readonly total: number; readonly maxPerTable: number } | null;
}

export interface ContainerSummary {
  readonly account: StorageAccountName;
  readonly name: string;
  readonly blobs: number;
  readonly bytes: Distribution;
  readonly rootBlobs: number;
  readonly blobsPerFolder: Distribution;
}

export interface StatsSummary {
  readonly sql: SqlCounts & { readonly personalSurveys: number };
  readonly tables: Readonly<Record<TableKind, TableGroupSummary>>;
  readonly containers: readonly ContainerSummary[];
  readonly resultBytesMeasured: boolean;
}

const TABLE_KINDS: readonly TableKind[] = [
  "responses",
  "deletedResponses",
  "completionMarkers",
  "surveyEvents",
  "other",
];

export function summariseStats(measurements: StatsMeasurements): StatsSummary {
  const tables = {} as Record<TableKind, TableGroupSummary>;
  for (const kind of TABLE_KINDS) {
    const group = measurements.tables.filter((t) => classifyTable(t.name) === kind);
    const chars = group.map((t) => t.resultChars ?? 0);
    tables[kind] = {
      tables: group.length,
      rows: distribution(group.map((t) => t.rows)),
      resultChars:
        measurements.resultBytesMeasured && kind === "responses"
          ? {
              total: chars.reduce((sum, value) => sum + value, 0),
              maxPerTable: Math.max(0, ...chars),
            }
          : null,
    };
  }
  return {
    sql: {
      ...measurements.sql,
      personalSurveys: measurements.sql.surveys - measurements.sql.projectSurveys,
    },
    tables,
    containers: measurements.containers.map((c) => ({
      account: c.account,
      name: c.name,
      blobs: c.blobSizes.length,
      bytes: distribution(c.blobSizes),
      rootBlobs: c.rootBlobs,
      blobsPerFolder: distribution(c.blobsPerFolder),
    })),
    resultBytesMeasured: measurements.resultBytesMeasured,
  };
}

const TABLE_TITLES: Readonly<Record<TableKind, string>> = {
  responses: "Responses (post*)",
  deletedResponses: "Deleted responses (postdelete*)",
  completionMarkers: "Completion markers (SurveyCompletion*)",
  surveyEvents: "Survey events (surveys)",
  other: "Other tables",
};

const spread = (d: Distribution) => `p50 ${d.p50}, p90 ${d.p90}, p99 ${d.p99}, max ${d.max}`;

/** Lines of `label  value`, the values aligned. */
function aligned(rows: readonly (readonly [string, string])[]): string[] {
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`);
}

export function formatStats(summary: StatsSummary): string {
  const { sql } = summary;
  const sqlLines = aligned([
    [
      "Surveys",
      `${sql.surveys} (personal ${sql.personalSurveys}, project ${sql.projectSurveys}, archived ${sql.archivedSurveys})`,
    ],
    ["Themes", `${sql.surveysWithTheme} surveys, ${sql.themeBytes} bytes`],
    [
      "Users",
      `${sql.users} (with an access key ${sql.usersWithAccessKey}, blocked ${sql.blockedUsers})`,
    ],
    ["Projects", `${sql.projects} (memberships ${sql.memberships})`],
  ]);
  const tableLines = aligned(
    TABLE_KINDS.map((kind) => {
      const group = summary.tables[kind];
      return [
        TABLE_TITLES[kind],
        `${group.tables} tables, ${group.rows.total} rows; per table ${spread(group.rows)}`,
      ] as const;
    }),
  );
  const responses = summary.tables.responses.resultChars;
  const resultLine = responses
    ? `Result text: ${responses.total} UTF-16 code units; largest table ${responses.maxPerTable}`
    : "Result text: not measured (pass --result-bytes)";
  const containerLines =
    summary.containers.length === 0
      ? ["(no containers)"]
      : aligned(
          summary.containers.map((c) => {
            const folders =
              c.blobsPerFolder.count > 0
                ? `; ${c.rootBlobs} at the root; per folder ${spread(c.blobsPerFolder)}`
                : "";
            return [
              `${c.account}/${c.name}`,
              `${c.blobs} blobs, ${c.bytes.total} bytes; per blob ${spread(c.bytes)}${folders}`,
            ] as const;
          }),
        );
  return [
    "SQL",
    ...sqlLines,
    "",
    "Azure tables",
    ...tableLines,
    resultLine,
    "",
    "Blob containers",
    ...containerLines,
    "",
    "File shares (surveyfiles, files, tempfiles): not read; take their used capacity from the " +
      "Azure portal (storage account › File shares).",
    "",
  ].join("\n");
}
