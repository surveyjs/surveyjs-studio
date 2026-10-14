import { pathToFileURL } from "node:url";
import { ConfigError, loadConfig } from "../config.js";
import type { ProjectMembership, SurveyRecord, User } from "../domain/types.js";
import { LegacyStoreError } from "../providers/azure-legacy/index.js";
import { createProviders, type ProviderSet } from "../providers/index.js";

export type ParsedArgs =
  | { kind: "run"; user: string; envFile: string | null }
  | { kind: "help" }
  | { kind: "usage-error"; message: string };

export const USAGE = `Usage: pnpm inspect:legacy --user <id|email> [--env-file <path>]

Lists the surveys of one user (personal and per project) from the configured store.
Read-only: it never writes.

Options:
  --user <id|email>   User GUID or email address (required)
  --env-file <path>   Load environment variables from this file first;
                      variables already set in the environment win
  --help              Show this text

Exit codes: 0 success, 1 user not found or store error, 2 usage error`;

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let user: string | null = null;
  let envFile: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help") return { kind: "help" };
    // Node reads --env-file anywhere on its command line; the package script ends with "--"
    // so that Node leaves our arguments alone and this tool reports a missing file itself.
    if (arg === "--") continue;
    if (arg === "--user" || arg === "--env-file") {
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
  if (user === null) return { kind: "usage-error", message: "--user is required" };
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

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

/** Runs the inspector. Returns the exit code; never throws. Calls only read methods. */
export async function run(
  argv: readonly string[],
  io: CliIo,
  makeProviders: typeof createProviders = createProviders,
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
  if (args.envFile !== null) {
    try {
      process.loadEnvFile(args.envFile); // does not override variables that are already set
    } catch {
      io.err(`Cannot read the env file: ${args.envFile}\n`);
      return 2;
    }
  }
  let providers: ProviderSet | null = null;
  try {
    const config = loadConfig(process.env);
    providers = await makeProviders(config, {
      logger: {
        warn: (details, message) => io.err(`warning: ${message} ${JSON.stringify(details)}\n`),
      },
    });
    const user = GUID.test(args.user)
      ? await providers.directory.getUser(args.user)
      : await providers.directory.findUserByEmail(args.user);
    if (user === null) {
      io.err(`User not found: ${args.user}\n`);
      return 1;
    }
    const personal = await providers.surveys.listSurveys({ kind: "personal", userId: user.id });
    const memberships = await providers.directory.listUserProjects(user.id);
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
    // Only these two error types are known to be free of connection-string values.
    const safe = error instanceof ConfigError || error instanceof LegacyStoreError;
    io.err(`Error: ${safe ? error.message : "unexpected failure"}\n`);
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
