import { createSeededSqlProviders, scratchCredentials } from "./sql-suite-setup.js";
import { describeCredentialStoreSuite } from "./suite/credential-store-suite.js";
import { describeProviderSuite } from "./suite/provider-suite.js";

describeProviderSuite("sqlite (legacy fixture seed)", () => createSeededSqlProviders("sqlite"));

describeCredentialStoreSuite("sqlite", () => scratchCredentials("sqlite"));
