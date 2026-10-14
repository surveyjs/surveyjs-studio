import type { LegacyConfig } from "../config.js";
import { LEGACY_VARIABLES } from "./endpoint-guard.js";

/**
 * Connection strings of the local replica for the `providers-azurite` Vitest project. The root
 * script `pnpm test:providers:azurite` reads them from docker/azurite.env. Missing ones fail the
 * run with a clear message: these tests are never skipped silently.
 */
export function replicaConfig(env: NodeJS.ProcessEnv = process.env): LegacyConfig {
  const missing = LEGACY_VARIABLES.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(", ")} not set. Run the replica tests with \`pnpm test:providers:azurite\` ` +
        "(it reads docker/azurite.env) after `pnpm demo:azurite:up`.",
    );
  }
  return {
    sqlConnectionString: env.LEGACY_SQL_CONNECTION_STRING ?? "",
    surveysStorageConnectionString: env.LEGACY_SURVEYS_STORAGE_CONNECTION_STRING ?? "",
    resultsStorageConnectionString: env.LEGACY_RESULTS_STORAGE_CONNECTION_STRING ?? "",
  };
}

/** The same values in the variable form the fixture loader takes. */
export function replicaEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const config = replicaConfig(env);
  return {
    LEGACY_SQL_CONNECTION_STRING: config.sqlConnectionString,
    LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: config.surveysStorageConnectionString,
    LEGACY_RESULTS_STORAGE_CONNECTION_STRING: config.resultsStorageConnectionString,
  };
}
