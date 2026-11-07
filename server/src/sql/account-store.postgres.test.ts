import { describeLocalAccountSuite } from "../providers/suite/account-store-suite.js";
import { scratchLocalAccounts } from "./account-store-runner.js";

describeLocalAccountSuite("postgres", () => scratchLocalAccounts("postgres"));
