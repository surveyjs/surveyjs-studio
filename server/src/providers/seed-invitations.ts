import type { MemorySeed } from "./memory.js";
import type { ProjectInvitation } from "./types.js";

/** When the seed's invitation was made, as the seed's accounts were (sql/seed.ts). */
const SEEDED_AT = "2025-01-01T00:00:00.000Z";

/**
 * The shared seed's pending invitation (self-hosted Step 8): invited@example.com may join Marketing
 * (project A of the golden fixtures) as a user, invited by its owner. Only a local user directory
 * has invitations, so the memory and SQL seeds of one load it; the Azure replica and the legacy
 * fixtures do not have it.
 */
export const seedInvitation: ProjectInvitation = {
  projectId: "55555555-0000-4000-8000-a00000000001",
  email: "invited@example.com",
  role: "user",
  invitedBy: "11111111-0000-4000-8000-a00000000001",
  createdAt: SEEDED_AT,
};

/** The seed with the shared invitation added (a seed of another shape is left alone). */
export const withSeedInvitation = (seed: MemorySeed): MemorySeed => ({
  ...seed,
  invitations: [...(seed.invitations ?? []), seedInvitation],
});
