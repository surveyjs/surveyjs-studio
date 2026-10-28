import type { Clock } from "../auth/session.js";
import type { AccountNoticesSetting, AppConfig } from "../config.js";
import { createSurveyjsApiDirectory } from "../users/surveyjs-api/client.js";
import { createAzureLegacyProviders, type LegacyWarningLogger } from "./azure-legacy/index.js";
import { legacyFixtureSeed } from "./azure-legacy/fixtures.js";
import { createMemoryProviders } from "./memory.js";
import { openSqlProviders } from "./sql.js";
import type { ProviderSet, ReadinessCheck } from "./types.js";

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
    config.memorySeed === "legacy-fixtures" ? await legacyFixtureSeed() : undefined,
    { accountNotices },
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
  sqlite: (config, _options, accountNotices) => openSqlProviders(config, accountNotices),
  postgres: (config, _options, accountNotices) => openSqlProviders(config, accountNotices),
};

export async function createProviders(
  config: AppConfig,
  options: ProviderOptions = {},
): Promise<ProviderSet> {
  // The storage provider's own users and notices serve memory and surveyjs-sql (R7). With the
  // user API, the storage provider gets no licence setting: the API answers licence state.
  const external = config.userDirectory === "surveyjs-api";
  const storage = await registry[config.storageProvider](
    config,
    options,
    external ? "none" : config.accountNotices,
  );
  if (!external) return storage;
  if (config.userApi === null) {
    await storage.close();
    throw new Error("USER_DIRECTORY=surveyjs-api needs USER_API_URL and USER_API_TOKEN");
  }
  const api = createSurveyjsApiDirectory({
    baseUrl: config.userApi.url,
    token: config.userApi.token,
    accountNotices: config.accountNotices,
    ...(options.now && { now: options.now }),
  });
  return {
    ...storage,
    users: api.users,
    notices: api.notices,
    readinessNames: [...storage.readinessNames, "user-api"],
    async ready(): Promise<readonly ReadinessCheck[]> {
      const [checks, probe] = await Promise.all([storage.ready(), api.probe()]);
      return [...checks, { name: "user-api", ...probe }];
    },
  };
}
