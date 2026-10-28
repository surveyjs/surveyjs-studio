import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { ConfigError, loadConfig } from "../config.js";
import { LegacyStoreError } from "../providers/azure-legacy/index.js";
import { createProviders, type ProviderSet } from "../providers/index.js";
import { DatabaseTooNewError, MigrationMismatchError } from "../sql/migrator.js";
import { UserApiError } from "../users/surveyjs-api/client.js";

/** Shared parts of the operator commands (`inspect:legacy`, `account:erase`, `account:reconcile`, `webhook:account-deleted`). */

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export type CliEnv = Readonly<Record<string, string | undefined>>;

export { GUID } from "../domain/guid.js";

export type ParsedFlags =
  | {
      readonly kind: "run";
      /** The value of each option given (the last one wins). */
      readonly values: Readonly<Partial<Record<string, string>>>;
      /** The switches given. */
      readonly switches: ReadonlySet<string>;
    }
  | { readonly kind: "help" }
  | { readonly kind: "usage-error"; readonly message: string };

/**
 * Reads `--name value` options and `--name` switches; `--help` anywhere wins. A lone `--` is
 * skipped: Node reads `--env-file` anywhere on its command line, so the package scripts end with
 * `--` and this tool reports a missing file itself.
 */
export function parseFlags(
  argv: readonly string[],
  spec: { readonly options: readonly string[]; readonly switches: readonly string[] },
): ParsedFlags {
  const values: Partial<Record<string, string>> = {};
  const switches = new Set<string>();
  if (argv.includes("--help")) return { kind: "help" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") continue;
    if (spec.options.includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return { kind: "usage-error", message: `${arg} needs a value` };
      }
      i++;
      values[arg] = value;
    } else if (spec.switches.includes(arg)) {
      switches.add(arg);
    } else {
      return { kind: "usage-error", message: `Unknown argument: ${arg}` };
    }
  }
  return { kind: "run", values, switches };
}

/** `unexpected failure (TypeError, code ESOCKET)`: the error name and a plain-identifier code. */
export function describeUnexpected(error: unknown): string {
  const details: string[] = [];
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_]*$/.test(error.name)) {
    details.push(error.name);
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Z][A-Z0-9_]*$/.test(code)) details.push(`code ${code}`);
  return details.length > 0 ? `unexpected failure (${details.join(", ")})` : "unexpected failure";
}

/**
 * The text of an error that may be printed. Only these error types are known to be free of
 * connection strings, tokens and secrets; any other message or stack may hold one, so only the
 * error's name and a safe code are given.
 */
export function safeErrorText(error: unknown): string {
  const safe =
    error instanceof ConfigError ||
    error instanceof LegacyStoreError ||
    error instanceof UserApiError ||
    error instanceof DatabaseTooNewError ||
    error instanceof MigrationMismatchError;
  return safe ? error.message : describeUnexpected(error);
}

/**
 * `env` with the variables of the file added; variables already in `env` win (as Node's
 * `--env-file`). null when the file cannot be read or parsed.
 */
export function withEnvFile(env: CliEnv, path: string): Record<string, string | undefined> | null {
  let parsed: Record<string, string>;
  try {
    parsed = parseEnv(readFileSync(path, "utf8")) as Record<string, string>;
  } catch {
    return null;
  }
  return {
    ...parsed,
    ...Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)),
  };
}

/** R13: the commands that erase refuse the memory store, whose data lives in a server process. */
export const MEMORY_REFUSAL =
  "STORAGE_PROVIDER must name a persistent store: memory keeps its data inside the server " +
  "process. Pass --env-file docker/azurite.env for the local replica.";

export interface StoreCommandDeps {
  /** Default `process.env` (never changed: `--env-file` values go into a copy). */
  readonly env?: CliEnv;
  /** Default `createProviders`. */
  readonly makeProviders?: typeof createProviders;
  /** Default `Date.now`. */
  readonly now?: () => number;
}

/** Printed by a command that would write when `READ_ONLY=true` (design D5). */
export const READ_ONLY_REFUSAL = "Refused: READ_ONLY=true. Nothing was erased.";

/**
 * Runs `body` with the configured providers and closes them after. Exit 2 for an unreadable env
 * file, a memory store, or `writes` with `READ_ONLY=true` (`makeProviders` is not called); exit 1
 * with `Error: <safe text>` when the configuration or `body` fails. `writes`: `body` may write
 * (the command's `--yes` or `--apply`); its dry run is not refused. `readOnlyRefusal` replaces
 * READ_ONLY_REFUSAL for a command that does not erase.
 */
export async function withProviders(
  envFile: string | null,
  io: CliIo,
  deps: StoreCommandDeps,
  options: { readonly writes: boolean; readonly readOnlyRefusal?: string },
  body: (providers: ProviderSet) => Promise<number>,
): Promise<number> {
  let env: CliEnv = deps.env ?? process.env;
  if (envFile !== null) {
    const loaded = withEnvFile(env, envFile);
    if (loaded === null) {
      io.err(`Cannot read the env file: ${envFile}\n`);
      return 2;
    }
    env = loaded;
  }
  const provider = env.STORAGE_PROVIDER?.trim();
  if (!provider || provider === "memory") {
    io.err(`${MEMORY_REFUSAL}\n`);
    return 2;
  }
  let providers: ProviderSet | null = null;
  try {
    const config = loadConfig({ ...env }, { skipIdentityRules: true });
    if (options.writes && config.readOnly) {
      io.err(`${options.readOnlyRefusal ?? READ_ONLY_REFUSAL}\n`);
      return 2;
    }
    providers = await (deps.makeProviders ?? createProviders)(config, {
      logger: {
        warn: (details, message) => io.err(`warning: ${message} ${JSON.stringify(details)}\n`),
      },
    });
    return await body(providers);
  } catch (error) {
    io.err(`Error: ${safeErrorText(error)}\n`);
    return 1;
  } finally {
    if (providers) await providers.close().catch(() => undefined);
  }
}
