import { createMemoryLocalAccounts } from "./memory-accounts.js";
import { describeLocalAccountSuite } from "./suite/account-store-suite.js";

describeLocalAccountSuite("memory", () =>
  Promise.resolve({ ...createMemoryLocalAccounts(), close: () => Promise.resolve() }),
);
