import { describeInvitationSuite } from "../providers/suite/invitation-store-suite.js";
import { scratchInvitations } from "./invitation-store-runner.js";

describeInvitationSuite("sqlite", () => scratchInvitations("sqlite"));
