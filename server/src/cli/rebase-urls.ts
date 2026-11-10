import { pathToFileURL } from "node:url";
import type { Kysely } from "kysely";
import { loadConfig } from "../config.js";
import { filePath } from "../files/service.js";
import { openDatabase, type SqlDatabase } from "../sql/database.js";
import type { DatabaseSchema } from "../sql/schema.js";
import { versionOf } from "../sql/survey-store.js";
import { jsonOf, jsonText } from "../sql/values.js";
import { describeTarget } from "./db.js";
import { parseFlags, safeErrorText, withEnvFile, type CliEnv, type CliIo } from "./common.js";

export const USAGE = `Usage: surveyjs-studio rebase-urls --from <old base URL> --to <new base URL> [--yes]
                               [--env-file <path>]

A stored file's URL starts with the PUBLIC_BASE_URL it was uploaded under, and the editor
writes that URL into the survey. After PUBLIC_BASE_URL changes, this command replaces
<old base URL>/api/v1/public/files/ with <new base URL>/api/v1/public/files/ in every survey
definition, theme, history snapshot and response. No other text changes. A rewritten
definition or theme gets a new version, so an editor still open on the old one must reload
before it can save.

Without --yes it only counts what it would change (a dry run). Stop the server and make a
backup (surveyjs-studio backup) before you run it with --yes. STORAGE_PROVIDER must be sqlite
or postgres. All changes are written in one transaction.

Options:
  --from <url>        The old PUBLIC_BASE_URL (http or https, no query or fragment)
  --to <url>          The new PUBLIC_BASE_URL
  --yes               Write the changes
  --env-file <path>   Load environment variables from this file first;
                      variables already set in the environment win
  --help              Show this text

Exit codes: 0 success, 1 database error, 2 usage error, no SQL storage provider, or
READ_ONLY=true with --yes`;

export interface RebaseReport {
  readonly definitions: number;
  readonly themes: number;
  readonly snapshots: number;
  readonly responses: number;
}

export interface RebaseOptions {
  /** Normalised base URLs (no trailing slash). */
  readonly from: string;
  readonly to: string;
  /** false: count only. */
  readonly write: boolean;
  /** Rows read per query; default 200. */
  readonly pageSize?: number;
}

/** The value with every occurrence of `from` in its strings (not its keys) replaced by `to`. */
function replaced(value: unknown, from: string, to: string): unknown {
  if (typeof value === "string") return value.includes(from) ? value.split(from).join(to) : value;
  if (Array.isArray(value)) return value.map((item) => replaced(item, from, to));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaced(item, from, to)]),
    );
  }
  return value;
}

/** The rewritten JSON value of a column, or null when it has nothing to rewrite. */
function rewrite(column: unknown, from: string, to: string): Record<string, unknown> | null {
  if (column === null || column === undefined) return null;
  const value = jsonOf<unknown>(column);
  if (!JSON.stringify(value).includes(from)) return null;
  return replaced(value, from, to) as Record<string, unknown>;
}

async function surveys(
  db: Kysely<DatabaseSchema>,
  dialect: SqlDatabase["dialect"],
  from: string,
  to: string,
  write: boolean,
  page: number,
): Promise<{ definitions: number; themes: number }> {
  let definitions = 0;
  let themes = 0;
  // No start key on the first page: PostgreSQL's ids are uuid, which has no empty value.
  let after: string | null = null;
  for (;;) {
    let query = db.selectFrom("surveys").select(["id", "definition", "theme"]);
    if (after !== null) query = query.where("id", ">", after);
    const rows = await query.orderBy("id").limit(page).execute();
    for (const row of rows) {
      const definition = rewrite(row.definition, from, to);
      const theme = rewrite(row.theme, from, to);
      if (definition) definitions++;
      if (theme) themes++;
      if (!write || (!definition && !theme)) continue;
      await db
        .updateTable("surveys")
        .set({
          ...(definition && {
            definition: jsonText(dialect, definition),
            definition_version: versionOf(definition),
          }),
          ...(theme && { theme: jsonText(dialect, theme), theme_version: versionOf(theme) }),
        })
        .where("id", "=", row.id)
        .execute();
    }
    if (rows.length < page) return { definitions, themes };
    after = rows[rows.length - 1]!.id;
  }
}

/** survey_history.snapshot or survey_responses.data, keyed by (survey_id, id). */
async function keyedRows(
  db: Kysely<DatabaseSchema>,
  dialect: SqlDatabase["dialect"],
  table: "survey_history" | "survey_responses",
  from: string,
  to: string,
  write: boolean,
  page: number,
): Promise<number> {
  const column = table === "survey_history" ? "snapshot" : "data";
  let count = 0;
  let after: { survey: string; id: string } | null = null;
  for (;;) {
    let query = db.selectFrom(table).select(["survey_id", "id", `${column} as value`]);
    if (after !== null) {
      const { survey, id } = after;
      query = query.where((eb) =>
        eb.or([
          eb("survey_id", ">", survey),
          eb.and([eb("survey_id", "=", survey), eb("id", ">", id)]),
        ]),
      );
    }
    const rows = await query.orderBy("survey_id").orderBy("id").limit(page).execute();
    for (const row of rows) {
      const value = rewrite(row.value, from, to);
      if (!value) continue;
      count++;
      if (!write) continue;
      await db
        .updateTable(table)
        .set({ [column]: jsonText(dialect, value) })
        .where("survey_id", "=", row.survey_id)
        .where("id", "=", row.id)
        .execute();
    }
    if (rows.length < page) return count;
    const last = rows[rows.length - 1]!;
    after = { survey: last.survey_id, id: last.id };
  }
}

/**
 * Replaces `<from>/api/v1/public/files/` with `<to>/api/v1/public/files/` in the definitions,
 * themes, history snapshots and responses, in one transaction; counts only when `write` is false.
 */
export async function rebaseFileUrls(
  database: SqlDatabase,
  { from, to, write, pageSize = 200 }: RebaseOptions,
): Promise<RebaseReport> {
  const oldPrefix = from + filePath("");
  const newPrefix = to + filePath("");
  return database.db.transaction().execute(async (trx) => {
    const { definitions, themes } = await surveys(
      trx,
      database.dialect,
      oldPrefix,
      newPrefix,
      write,
      pageSize,
    );
    const snapshots = await keyedRows(
      trx,
      database.dialect,
      "survey_history",
      oldPrefix,
      newPrefix,
      write,
      pageSize,
    );
    const responses = await keyedRows(
      trx,
      database.dialect,
      "survey_responses",
      oldPrefix,
      newPrefix,
      write,
      pageSize,
    );
    return { definitions, themes, snapshots, responses };
  });
}

/** The base URL without a trailing slash, or null when it is not a plain http(s) URL. */
export function baseUrlOf(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
    return null;
  }
  // Text the URL parser would have rewritten (a quote, a backslash) is refused by the check above
  // or ends up percent-encoded, so the prefix is safe inside JSON strings.
  return url.origin + url.pathname.replace(/\/+$/, "");
}

const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

const describe = (report: RebaseReport) =>
  [
    plural(report.definitions, "definition", "definitions"),
    plural(report.themes, "theme", "themes"),
    plural(report.snapshots, "history snapshot", "history snapshots"),
    plural(report.responses, "response", "responses"),
  ].join(", ");

export interface RebaseCommandDeps {
  /** Default `process.env` (never changed: `--env-file` values go into a copy). */
  readonly env?: CliEnv;
}

/** Runs `rebase-urls`. Returns the exit code; never throws. */
export async function run(
  argv: readonly string[],
  io: CliIo,
  deps: RebaseCommandDeps = {},
): Promise<number> {
  const flags = parseFlags(argv, {
    options: ["--from", "--to", "--env-file"],
    switches: ["--yes"],
  });
  if (flags.kind === "help") {
    io.out(USAGE + "\n");
    return 0;
  }
  if (flags.kind === "usage-error") {
    io.err(`${flags.message}\n\n${USAGE}\n`);
    return 2;
  }
  const usage = (message: string) => {
    io.err(`${message}\n\n${USAGE}\n`);
    return 2;
  };
  const fromText = flags.values["--from"];
  const toText = flags.values["--to"];
  if (fromText === undefined || toText === undefined) {
    return usage("--from and --to are both needed");
  }
  const from = baseUrlOf(fromText);
  if (from === null)
    return usage("--from must be an http or https URL, without a query or fragment");
  const to = baseUrlOf(toText);
  if (to === null) return usage("--to must be an http or https URL, without a query or fragment");
  if (from === to) return usage("--from and --to are the same");
  const write = flags.switches.has("--yes");

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
  const provider = env.STORAGE_PROVIDER?.trim();
  if (provider !== "sqlite" && provider !== "postgres") {
    io.err("STORAGE_PROVIDER must be sqlite or postgres: no other provider has a database.\n");
    return 2;
  }
  let database: SqlDatabase | null = null;
  try {
    const config = loadConfig({ ...env }, { skipIdentityRules: true });
    if (write && config.readOnly) {
      io.err("Refused: READ_ONLY=true. Nothing was written.\n");
      return 2;
    }
    database = openDatabase(config.database!);
    io.out(`Database: ${describeTarget(config.database!)}\n`);
    io.out(`Replacing ${from}${filePath("")} with ${to}${filePath("")}\n`);
    const report = await rebaseFileUrls(database, { from, to, write });
    if (write) {
      io.out(`Rewrote ${describe(report)}.\n`);
    } else {
      io.out(`Would rewrite ${describe(report)}.\n`);
      io.out("Dry run: nothing was written. Run again with --yes to write.\n");
    }
    return 0;
  } catch (error) {
    io.err(`Error: ${safeErrorText(error)}\n`);
    return 1;
  } finally {
    if (database) await database.close().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
