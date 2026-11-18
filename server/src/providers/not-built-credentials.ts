import type { CredentialStore } from "./types.js";

/** A stand-in whose every method rejects, until the provider's own store is built (hosted Step 3). */
export function notBuiltCredentials(provider: string, task: number): CredentialStore {
  const fail = (): Promise<never> =>
    Promise.reject(
      new Error(
        `CredentialStore: not built for ${provider} yet (hosted Step 3, Task ${String(task)})`,
      ),
    );
  return {
    createApiToken: fail,
    findApiToken: fail,
    listApiTokens: fail,
    revokeApiToken: fail,
    replaceApiTokenHash: fail,
    touchApiToken: fail,
    revokeApiTokensOfCreator: fail,
    revokeApiTokensOfProject: fail,
    findLegacyKey: fail,
    legacyKeyOf: fail,
    revokeLegacyKey: fail,
  };
}
