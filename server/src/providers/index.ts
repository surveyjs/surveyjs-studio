import type { AppConfig } from "../config.js";
import { legacyFixtureSeed } from "./azure-legacy/fixtures.js";
import { createMemoryProviders } from "./memory.js";
import type { ProviderSet } from "./types.js";

export type { ProviderSet } from "./types.js";

async function createMemory(config: AppConfig): Promise<ProviderSet> {
  return createMemoryProviders(
    config.memorySeed === "legacy-fixtures" ? await legacyFixtureSeed() : undefined,
  );
}

const registry: Record<AppConfig["storageProvider"], (config: AppConfig) => Promise<ProviderSet>> =
  {
    memory: createMemory,
  };

export function createProviders(config: AppConfig): Promise<ProviderSet> {
  return registry[config.storageProvider](config);
}
