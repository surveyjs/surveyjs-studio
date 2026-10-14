import type { AppConfig } from "../config.js";
import { createAzureLegacyProviders } from "./azure-legacy/index.js";
import { legacyFixtureSeed } from "./azure-legacy/fixtures.js";
import { createMemoryProviders } from "./memory.js";
import type { ProviderSet } from "./types.js";

export type { ProviderSet } from "./types.js";

async function createMemory(config: AppConfig): Promise<ProviderSet> {
  return createMemoryProviders(
    config.memorySeed === "legacy-fixtures" ? await legacyFixtureSeed() : undefined,
  );
}

async function createAzureLegacy(config: AppConfig): Promise<ProviderSet> {
  if (!config.legacy) throw new Error("STORAGE_PROVIDER=azure-legacy needs the LEGACY_* settings");
  return createAzureLegacyProviders(config.legacy);
}

const registry: Record<AppConfig["storageProvider"], (config: AppConfig) => Promise<ProviderSet>> =
  {
    memory: createMemory,
    "azure-legacy": createAzureLegacy,
  };

export function createProviders(config: AppConfig): Promise<ProviderSet> {
  return registry[config.storageProvider](config);
}
