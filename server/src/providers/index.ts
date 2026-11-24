import type { Clock } from "../auth/session.js";
import type { AccountNoticesSetting, AppConfig } from "../config.js";
import { createAzureLegacyProviders, type LegacyWarningLogger } from "./azure-legacy/index.js";
import { legacyFixtureSeed } from "./azure-legacy/fixtures.js";
import { createMemoryProviders } from "./memory.js";
import { withSeedInvitation } from "./seed-invitations.js";
import { openSqlProviders } from "./sql.js";
import type { ProviderSet } from "./types.js";

export type { ProviderSet } from "./types.js";

export interface ProviderOptions {
  /** Receives warnings about legacy rows that are skipped (row ids only). */
  readonly logger?: LegacyWarningLogger;
  /** Clock for the licence-expiry notices (tests); default `Date.now`. */
  readonly now?: Clock;
}

async function createMemory(
  config: AppConfig,
  _options: ProviderOptions,
  accountNotices: AccountNoticesSetting,
): Promise<ProviderSet> {
  return createMemoryProviders(
    config.memorySeed === "legacy-fixtures"
      ? withSeedInvitation(await legacyFixtureSeed())
      : undefined,
    {
      accountNotices,
      ...(config.userDirectory === "local" && { userDirectory: "local" as const }),
    },
  );
}

async function createAzureLegacy(
  config: AppConfig,
  options: ProviderOptions,
  accountNotices: AccountNoticesSetting,
): Promise<ProviderSet> {
  if (!config.legacy) throw new Error("STORAGE_PROVIDER=azure-legacy needs the LEGACY_* settings");
  return createAzureLegacyProviders(config.legacy, {
    logger: options.logger,
    accountNotices,
    now: options.now,
  });
}

const registry: Record<
  AppConfig["storageProvider"],
  (
    config: AppConfig,
    options: ProviderOptions,
    accountNotices: AccountNoticesSetting,
  ) => Promise<ProviderSet>
> = {
  memory: createMemory,
  "azure-legacy": createAzureLegacy,
  sqlite: (config, options, accountNotices) =>
    openSqlProviders(config, accountNotices, options.logger),
  postgres: (config, options, accountNotices) =>
    openSqlProviders(config, accountNotices, options.logger),
};

export async function createProviders(
  config: AppConfig,
  options: ProviderOptions = {},
): Promise<ProviderSet> {
  // The storage provider's own users and notices serve every user directory (R7).
  return registry[config.storageProvider](config, options, config.accountNotices);
}
