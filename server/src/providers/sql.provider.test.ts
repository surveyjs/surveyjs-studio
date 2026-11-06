import { SQL_SUITE_SECTIONS, createSeededSqlProviders } from "./sql-suite-setup.js";
import { describeProviderSuite } from "./suite/provider-suite.js";

describeProviderSuite("sqlite (legacy fixture seed)", () => createSeededSqlProviders("sqlite"), {
  sections: SQL_SUITE_SECTIONS,
});
