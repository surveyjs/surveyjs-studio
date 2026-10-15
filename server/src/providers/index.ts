import type { AppConfig } from "../config.js";
import { createAzureLegacyProviders, type LegacyWarningLogger } from "./azure-legacy/index.js";
import { legacyFixtureSeed } from "./azure-legacy/fixtures.js";
import { createMemoryProviders } from "./memory.js";
import type { ProviderSet } from "./types.js";

export type { ProviderSet } from "./types.js";

export interface ProviderOptions {
  /** Receives warnings about legacy rows that are skipped (row ids only). */
  readonly logger?: LegacyWarningLogger;
}

async function createMemory(config: AppConfig): Promise<ProviderSet> {
  return createMemoryProviders(
    config.memorySeed === "legacy-fixtures" ? await legacyFixtureSeed() : undefined,
  );
}

async function createAzureLegacy(
  config: AppConfig,
  options: ProviderOptions,
): Promise<ProviderSet> {
  if (!config.legacy) throw new Error("STORAGE_PROVIDER=azure-legacy needs the LEGACY_* settings");
  return createAzureLegacyProviders(config.legacy, { logger: options.logger });
}

const registry: Record<
  AppConfig["storageProvider"],
  (config: AppConfig, options: ProviderOptions) => Promise<ProviderSet>
> = {
  memory: createMemory,
  "azure-legacy": createAzureLegacy,
};

export function createProviders(
  config: AppConfig,
  options: ProviderOptions = {},
): Promise<ProviderSet> {
  return registry[config.storageProvider](config, options);
}
