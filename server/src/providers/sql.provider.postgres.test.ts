import { createSeededSqlProviders, scratchCredentials } from "./sql-suite-setup.js";
import { describeCredentialStoreSuite } from "./suite/credential-store-suite.js";
import { describeProviderSuite } from "./suite/provider-suite.js";

describeProviderSuite("postgres (legacy fixture seed)", () => createSeededSqlProviders("postgres"));

describeCredentialStoreSuite("postgres", () => scratchCredentials("postgres"));
