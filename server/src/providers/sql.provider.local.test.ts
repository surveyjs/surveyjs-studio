import { createSeededSqlProviders, localSuiteBytes } from "./sql-suite-setup.js";
import { describeProviderSuite } from "./suite/provider-suite.js";

describeProviderSuite(
  "sqlite with the local user directory (legacy fixture seed)",
  () => createSeededSqlProviders("sqlite", localSuiteBytes, { localAccounts: true }),
  { userDirectoryKind: "local" },
);
