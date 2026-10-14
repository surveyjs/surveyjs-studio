import { loadLegacyFixtures } from "./load-fixtures.js";
import { replicaEnv } from "./replica-env.js";

/**
 * Global setup of the `providers-azurite` Vitest project: loads the golden fixtures into the
 * local replica once, so the run is self-contained. Fails (never skips) when the replica is not
 * reachable. The loader refuses any endpoint that is not local.
 */
export async function setup(): Promise<void> {
  const env = replicaEnv();
  try {
    await loadLegacyFixtures(env, { log: () => undefined });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      "Could not load the legacy fixtures into the local replica. Is it running? " +
        `Start it with \`pnpm demo:azurite:up\`.\nCause: ${reason}`,
      { cause: error },
    );
  }
}
