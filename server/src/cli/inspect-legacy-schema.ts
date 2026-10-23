import { pathToFileURL } from "node:url";
import sql from "mssql";
import { parseFlags, safeErrorText, withEnvFile, type CliEnv, type CliIo } from "./common.js";

export type { CliIo } from "./common.js";

export const USAGE = `Usage: pnpm inspect:legacy-schema [--env-file <path>]

Prints what the app depends on in the legacy Surveys table: the theme column's type and
collation, the triggers on the table, the ispublished column's definition and default, and how
many surveys have an empty ispublished. Read-only: it runs SELECT on the sys.* views and one
COUNT on Surveys, and never prints the connection string.
LEGACY_SQL_CONNECTION_STRING must be set (for the local replica pass --env-file docker/azurite.env).

Options:
  --env-file <path>   Load environment variables from this file first;
                      variables already set in the environment win
  --help              Show this text

Exit codes: 0 success, 1 connection or query error, 2 usage error or no connection string`;

/** What the check reads from the database; \`null\` for a column the table does not have. */
export interface SchemaFacts {
  readonly theme: {
    readonly type: string;
    readonly length: number;
    readonly collation: string | null;
  } | null;
  readonly triggers: readonly string[];
  readonly ispublished: {
    readonly type: string;
    readonly nullable: boolean;
    readonly defaultDefinition: string | null;
  } | null;
  readonly total: number;
  readonly emptyIspublished: number;
}

const COLUMN_QUERY = `
SELECT c.name AS column_name, t.name AS type_name, c.max_length, c.is_nullable,
       c.collation_name, dc.definition AS default_definition
FROM sys.columns c
JOIN sys.types t ON t.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
WHERE c.object_id = OBJECT_ID('Surveys') AND c.name IN ('theme', 'ispublished')`;

const TRIGGER_QUERY = `SELECT name FROM sys.triggers WHERE parent_id = OBJECT_ID('Surveys') ORDER BY name`;

const COUNT_QUERY = `SELECT COUNT(*) AS total, COUNT(*) - COUNT(ispublished) AS empty FROM Surveys`;

/** Reads the facts with SELECTs only. */
export async function readSchemaFacts(pool: sql.ConnectionPool): Promise<SchemaFacts> {
  const columns = (await pool.request().query(COLUMN_QUERY)).recordset as {
    column_name: string;
    type_name: string;
    max_length: number;
    is_nullable: boolean;
    collation_name: string | null;
    default_definition: string | null;
  }[];
  const triggers = (await pool.request().query(TRIGGER_QUERY)).recordset as { name: string }[];
  const counts = (await pool.request().query(COUNT_QUERY)).recordset[0] as {
    total: number;
    empty: number;
  };
  const theme = columns.find((c) => c.column_name.toLowerCase() === "theme");
  const published = columns.find((c) => c.column_name.toLowerCase() === "ispublished");
  return {
    theme: theme
      ? { type: theme.type_name, length: theme.max_length, collation: theme.collation_name }
      : null,
    triggers: triggers.map((t) => t.name),
    ispublished: published
      ? {
          type: published.type_name,
          nullable: published.is_nullable,
          defaultDefinition: published.default_definition,
        }
      : null,
    total: counts.total,
    emptyIspublished: counts.empty,
  };
}

/** `-1` is `max`; the length of nchar and nvarchar is reported in bytes, two per character. */
function lengthText(type: string, length: number): string {
  if (length === -1) return "max";
  return String(type.startsWith("n") ? length / 2 : length);
}

export function formatFacts(facts: SchemaFacts): string {
  const theme = facts.theme
    ? `${facts.theme.type}(${lengthText(facts.theme.type, facts.theme.length)}) COLLATE ${facts.theme.collation ?? "none"}`
    : "column not found";
  const published = facts.ispublished
    ? `${facts.ispublished.type}, nullable ${facts.ispublished.nullable ? "yes" : "no"}, default ${facts.ispublished.defaultDefinition ?? "none"}`
    : "column not found";
  return [
    `Surveys.theme: ${theme}`,
    `Surveys triggers: ${facts.triggers.length > 0 ? facts.triggers.join(", ") : "none"}`,
    `Surveys.ispublished: ${published}`,
    `Surveys with an empty ispublished: ${facts.emptyIspublished} of ${facts.total}`,
    "",
  ].join("\n");
}

export interface SchemaCommandDeps {
  /** Default \`process.env\` (never changed: \`--env-file\` values go into a copy). */
  readonly env?: CliEnv;
  /** Default: connects with \`mssql\` and calls \`readSchemaFacts\`. */
  readonly read?: (connectionString: string) => Promise<SchemaFacts>;
}

async function readFromDatabase(connectionString: string): Promise<SchemaFacts> {
  const pool = new sql.ConnectionPool(connectionString);
  pool.on("error", () => undefined);
  try {
    await pool.connect();
    return await readSchemaFacts(pool);
  } finally {
    await pool.close().catch(() => undefined);
  }
}

/** Runs the check. Returns the exit code; never throws and never prints the connection string. */
export async function run(
  argv: readonly string[],
  io: CliIo,
  deps: SchemaCommandDeps = {},
): Promise<number> {
  const flags = parseFlags(argv, { options: ["--env-file"], switches: [] });
  if (flags.kind === "help") {
    io.out(USAGE + "\n");
    return 0;
  }
  if (flags.kind === "usage-error") {
    io.err(`${flags.message}\n\n${USAGE}\n`);
    return 2;
  }
  let env: CliEnv = deps.env ?? process.env;
  const envFile = flags.values["--env-file"];
  if (envFile !== undefined) {
    const loaded = withEnvFile(env, envFile);
    if (loaded === null) {
      io.err(`Cannot read the env file: ${envFile}\n`);
      return 2;
    }
    env = loaded;
  }
  const connectionString = env.LEGACY_SQL_CONNECTION_STRING?.trim();
  if (!connectionString) {
    io.err(
      "LEGACY_SQL_CONNECTION_STRING is not set. Pass --env-file docker/azurite.env for the local " +
        "replica, or set it for the store to check.\n",
    );
    return 2;
  }
  try {
    io.out(formatFacts(await (deps.read ?? readFromDatabase)(connectionString)));
    return 0;
  } catch (error) {
    io.err(`Error: ${safeErrorText(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
