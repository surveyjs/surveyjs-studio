import type { Clock } from "../auth/session.js";
import type { AppConfig } from "../config.js";
import { createAzureLegacyProviders, type LegacyWarningLogger } from "./azure-legacy/index.js";
import { legacyFixtureSeed } from "./azure-legacy/fixtures.js";
import { createMemoryProviders } from "./memory.js";
import type { ProviderSet } from "./types.js";

export type { ProviderSet } from "./types.js";

export interface ProviderOptions {
  /** Receives warnings about legacy rows that are skipped (row ids only). */
  readonly logger?: LegacyWarningLogger;
  /** Clock for the licence-expiry notices (tests); default `Date.now`. */
  readonly now?: Clock;
}

async function createMemory(config: AppConfig): Promise<ProviderSet> {
  return createMemoryProviders(
    config.memorySeed === "legacy-fixtures" ? await legacyFixtureSeed() : undefined,
    { accountNotices: config.accountNotices },
  );
}

async function createAzureLegacy(
  config: AppConfig,
  options: ProviderOptions,
): Promise<ProviderSet> {
  if (!config.legacy) throw new Error("STORAGE_PROVIDER=azure-legacy needs the LEGACY_* settings");
  return createAzureLegacyProviders(config.legacy, {
    logger: options.logger,
    accountNotices: config.accountNotices,
    now: options.now,
  });
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
  if (config.userDirectory === "surveyjs-api") {
    throw new Error("USER_DIRECTORY=surveyjs-api is not built yet");
  }
  return registry[config.storageProvider](config, options);
}
