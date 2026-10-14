import type { ProviderSet } from "./types.js";

/** Empty in-memory provider; store interfaces are added by later steps. */
export function createMemoryProviders(): ProviderSet {
  return {
    name: "memory",
    ready: () => Promise.resolve(true),
    close: () => Promise.resolve(),
  };
}
