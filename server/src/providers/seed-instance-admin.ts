import type { User } from "../domain/types.js";

/**
 * The shared seed's instance admin (self-hosted Step 5): a local account only, without a password,
 * signed in through the dev sign-in. It is not one of the legacy fixtures' users, so the Azure
 * replica and the provider suites keep theirs; the memory and SQL seeds of a local directory and the
 * dev sign-in page of one add it.
 */
export const seedInstanceAdmin: User = {
  id: "11111111-0000-4000-8000-a00000000007",
  email: "instance-admin@example.com",
  displayName: "Ivy Instance",
  blocked: false,
};
