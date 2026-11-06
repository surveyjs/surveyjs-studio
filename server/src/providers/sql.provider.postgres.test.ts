import { SQL_SUITE_SECTIONS, createSeededSqlProviders } from "./sql-suite-setup.js";
import { describeProviderSuite } from "./suite/provider-suite.js";

describeProviderSuite(
  "postgres (legacy fixture seed)",
  () => createSeededSqlProviders("postgres"),
  {
    sections: SQL_SUITE_SECTIONS,
  },
);
