import { pathToFileURL } from "node:url";
import { loadConfig, type LegacyConfig } from "../config.js";
import type { ProjectMembership, SurveyRecord, User } from "../domain/types.js";
import { measureLegacyStores, type MeasureOptions } from "../legacy/stats-source.js";
import { formatStats, summariseStats, type StatsMeasurements } from "../legacy/stats.js";
import { createProviders, type ProviderSet } from "../providers/index.js";
import { GUID, safeErrorText, withEnvFile, type CliEnv, type CliIo } from "./common.js";

export type { CliIo } from "./common.js";

export type ParsedArgs =
  | { kind: "run"; user: string; envFile: string | null }
  | { kind: "stats"; envFile: string | null; json: boolean; resultBytes: boolean }
  | { kind: "help" }
  | { kind: "usage-error"; message: string };

export const USAGE = `Usage: pnpm inspect:legacy --user <id|email> [--env-file <path>]
       pnpm inspect:legacy --stats [--json] [--result-bytes] [--env-file <path>]

--user lists the surveys of one user (personal and per project) from the configured store.
STORAGE_PROVIDER must be set (for the local replica pass --env-file docker/azurite.env); a
memory store needs MEMORY_SEED=legacy-fixtures.

--stats prints counts and sizes of the legacy stores: SQL rows, Azure tables by kind, blob
containers. It reads the three LEGACY_* connection strings. Its output holds no names or
values from the data, but production figures are private: keep them out of the repository.

Read-only: it never writes.

Options:
  --user <id|email>   User GUID or email address
  --stats             Counts and sizes instead of one user's surveys
  --json              With --stats: print the summary as JSON
  --result-bytes      With --stats: also sum the length of every response; reads all
                      response data, so it takes as long as copying it
  --env-file <path>   Load environment variables from this file first;
                      variables already set in the environment win
  --help              Show this text

Exit codes: 0 success, 1 user not found or store error, 2 usage error or no store to inspect`;

const STATS_SWITCHES: readonly string[] = ["--stats", "--json", "--result-bytes"];

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let user: string | null = null;
  let envFile: string | null = null;
  const switches = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help") return { kind: "help" };
    // Node reads --env-file anywhere on its command line; the package script ends with "--"
    // so that Node leaves our arguments alone and this tool reports a missing file itself.
    if (arg === "--") continue;
    if (STATS_SWITCHES.includes(arg)) {
      switches.add(arg);
    } else if (arg === "--user" || arg === "--env-file") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return { kind: "usage-error", message: `${arg} needs a value` };
      }
      i++;
      if (arg === "--user") user = value;
      else envFile = value;
    } else {
      return { kind: "usage-error", message: `Unknown argument: ${arg}` };
    }
  }
  const stats = switches.has("--stats");
  if (stats && user !== null) {
    return { kind: "usage-error", message: "Give --user or --stats, not both" };
  }
  if (stats) {
    return {
      kind: "stats",
      envFile,
      json: switches.has("--json"),
      resultBytes: switches.has("--result-bytes"),
    };
  }
  const statsOnly = [...switches][0];
  if (statsOnly !== undefined) {
    return { kind: "usage-error", message: `${statsOnly} needs --stats` };
  }
  if (user === null) return { kind: "usage-error", message: "--user or --stats is required" };
  return { kind: "run", user, envFile };
}

const COLUMNS = ["Id", "Name", "Published", "Archived", "Created", "Updated"] as const;

/** Fixed-width text table of surveys; `(no surveys)` when empty. */
export function formatSurveyTable(surveys: readonly SurveyRecord[]): string {
  if (surveys.length === 0) return "(no surveys)";
  const yesNo = (value: boolean) => (value ? "yes" : "no");
  const rows = surveys.map((s) => [
    s.id,
    s.name,
    yesNo(s.published),
    yesNo(s.archived),
    s.createdAt,
    s.updatedAt,
  ]);
  const widths = COLUMNS.map((title, c) =>
    Math.max(title.length, ...rows.map((r) => r[c]!.length)),
  );
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, c) => cell.padEnd(widths[c]!))
      .join("  ")
      .trimEnd();
  return [line(COLUMNS), ...rows.map(line)].join("\n");
}

export function formatReport(
  user: User,
  providerName: string,
  personal: readonly SurveyRecord[],
  projects: readonly { membership: ProjectMembership; surveys: readonly SurveyRecord[] }[],
): string {
  const parts = [
    `User: ${user.id}  ${user.email}  ${user.displayName}  (provider: ${providerName})`,
    `Personal\n${formatSurveyTable(personal)}`,
    ...projects.map(
      ({ membership, surveys }) =>
        `Project ${membership.project.name} (${membership.project.id}, role ${membership.role})\n${formatSurveyTable(surveys)}`,
    ),
  ];
  return parts.join("\n\n") + "\n";
}

const SET_THE_STORE =
  "Pass --env-file docker/azurite.env for the local replica, or set STORAGE_PROVIDER and the " +
  "variables of that store.";

/**
 * Why the environment names nothing to inspect, or null. Without this check the config defaults
 * to an empty memory store and every user looks missing.
 */
export function storeProblem(env: Readonly<Record<string, string | undefined>>): string | null {
  const provider = env.STORAGE_PROVIDER?.trim();
  if (!provider) return `No store to inspect: STORAGE_PROVIDER is not set. ${SET_THE_STORE}`;
  const seed = env.MEMORY_SEED?.trim();
  if (provider === "memory" && (!seed || seed === "empty")) {
    return (
      "No store to inspect: STORAGE_PROVIDER=memory without MEMORY_SEED=legacy-fixtures is " +
      `empty. ${SET_THE_STORE}`
    );
  }
  return null;
}

export interface StatsDeps {
  /** Default `process.env` (never changed: `--env-file` values go into a copy). */
  readonly env?: CliEnv;
  /** Default `measureLegacyStores`. */
  readonly measure?: (legacy: LegacyConfig, options: MeasureOptions) => Promise<StatsMeasurements>;
}

const LEGACY_STRINGS = [
  "LEGACY_SQL_CONNECTION_STRING",
  "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
  "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
] as const;

/** `--stats`: measures the legacy stores and prints the summary. Never prints a connection string. */
async function runStats(
  args: Extract<ParsedArgs, { kind: "stats" }>,
  io: CliIo,
  deps: StatsDeps,
): Promise<number> {
  let env: CliEnv = deps.env ?? process.env;
  if (args.envFile !== null) {
    const loaded = withEnvFile(env, args.envFile);
    if (loaded === null) {
      io.err(`Cannot read the env file: ${args.envFile}\n`);
      return 2;
    }
    env = loaded;
  }
  const missing = LEGACY_STRINGS.filter((variable) => !env[variable]?.trim());
  if (missing.length > 0) {
    io.err(
      `Not set: ${missing.join(", ")}. Pass --env-file ` +
        "docker/azurite.env for the local replica, or set them for the stores to measure.\n",
    );
    return 2;
  }
  const value = (variable: string) => env[variable]!.trim();
  const legacy: LegacyConfig = {
    sqlConnectionString: value("LEGACY_SQL_CONNECTION_STRING"),
    surveysStorageConnectionString: value("LEGACY_SURVEYS_STORAGE_CONNECTION_STRING"),
    resultsStorageConnectionString: value("LEGACY_RESULTS_STORAGE_CONNECTION_STRING"),
  };
  try {
    const measurements = await (deps.measure ?? measureLegacyStores)(legacy, {
      resultBytes: args.resultBytes,
      progress: (line) => io.err(`${line}\n`),
    });
    const summary = summariseStats(measurements);
    io.out(args.json ? `${JSON.stringify(summary, null, 2)}\n` : formatStats(summary));
    return 0;
  } catch (error) {
    io.err(`Error: ${safeErrorText(error)}\n`);
    return 1;
  }
}

/** Runs the inspector. Returns the exit code; never throws. Calls only read methods. */
export async function run(
  argv: readonly string[],
  io: CliIo,
  makeProviders: typeof createProviders = createProviders,
  statsDeps: StatsDeps = {},
): Promise<number> {
  const args = parseArgs(argv);
  if (args.kind === "help") {
    io.out(USAGE + "\n");
    return 0;
  }
  if (args.kind === "usage-error") {
    io.err(`${args.message}\n\n${USAGE}\n`);
    return 2;
  }
  if (args.kind === "stats") return runStats(args, io, statsDeps);
  if (args.envFile !== null) {
    try {
      process.loadEnvFile(args.envFile); // does not override variables that are already set
    } catch {
      io.err(`Cannot read the env file: ${args.envFile}\n`);
      return 2;
    }
  }
  const problem = storeProblem(process.env);
  if (problem !== null) {
    io.err(`${problem}\n`);
    return 2;
  }
  let providers: ProviderSet | null = null;
  try {
    const config = loadConfig(process.env, { skipIdentityRules: true });
    providers = await makeProviders(config, {
      logger: {
        warn: (details, message) => io.err(`warning: ${message} ${JSON.stringify(details)}\n`),
      },
    });
    const user = GUID.test(args.user)
      ? await providers.users.getUser(args.user)
      : await providers.users.findUserByEmail(args.user);
    if (user === null) {
      io.err(`User not found in the ${providers.name} store: ${args.user}\n`);
      return 1;
    }
    const personal = await providers.surveys.listSurveys({ kind: "personal", userId: user.id });
    const memberships = await providers.projects.listUserProjects(user.id);
    const projects = [];
    for (const membership of memberships) {
      const surveys = await providers.surveys.listSurveys({
        kind: "project",
        projectId: membership.project.id,
      });
      projects.push({ membership, surveys });
    }
    io.out(formatReport(user, providers.name, personal, projects));
    return 0;
  } catch (error) {
    io.err(`Error: ${safeErrorText(error)}\n`);
    return 1;
  } finally {
    if (providers) await providers.close().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
