import { replicaConfig } from "../legacy/replica-env.js";
import { createAzureLegacyProviders } from "./azure-legacy/index.js";
import { describeLicenceNoticeSuite } from "./suite/licence-notice-suite.js";
import { describeProviderSuite } from "./suite/provider-suite.js";

// Runs in the `providers-azurite` Vitest project: `pnpm test:providers:azurite`. Its global setup
// loads the golden fixtures into the local replica first.
describeProviderSuite("azure-legacy (local replica)", () =>
  Promise.resolve(createAzureLegacyProviders(replicaConfig())),
);

describeLicenceNoticeSuite("azure-legacy (local replica)", (now) =>
  Promise.resolve(
    createAzureLegacyProviders(replicaConfig(), { accountNotices: "surveyjs-licenses", now }),
  ),
);
