import { createSeededSqlProviders, localSuiteBytes } from "./sql-suite-setup.js";
import { describeProviderSuite } from "./suite/provider-suite.js";

describeProviderSuite(
  "postgres with the local user directory (legacy fixture seed)",
  () => createSeededSqlProviders("postgres", localSuiteBytes, { localAccounts: true }),
  { userDirectoryKind: "local" },
);
