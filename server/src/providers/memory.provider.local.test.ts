import { legacyFixtureSeed } from "./azure-legacy/fixtures.js";
import { createMemoryProviders } from "./memory.js";
import { describeProviderSuite } from "./suite/provider-suite.js";

describeProviderSuite(
  "memory with the local user directory (legacy fixture seed)",
  async () => createMemoryProviders(await legacyFixtureSeed(), { userDirectory: "local" }),
  { userDirectoryKind: "local" },
);
