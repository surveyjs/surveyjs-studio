import type { AppConfig } from "../config.js";
import { createMemoryProviders } from "./memory.js";
import type { ProviderSet } from "./types.js";

export type { ProviderSet } from "./types.js";

const registry: Record<AppConfig["storageProvider"], () => ProviderSet> = {
  memory: createMemoryProviders,
};

export function createProviders(config: AppConfig): ProviderSet {
  return registry[config.storageProvider]();
}
