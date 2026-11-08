import { createMemoryProviders } from "./memory.js";
import { describeInvitationSuite } from "./suite/invitation-store-suite.js";

describeInvitationSuite("memory", () => {
  const providers = createMemoryProviders(undefined, { userDirectory: "local" });
  return Promise.resolve({
    invitations: providers.invitations!,
    projects: providers.projects,
    close: () => providers.close(),
  });
});
