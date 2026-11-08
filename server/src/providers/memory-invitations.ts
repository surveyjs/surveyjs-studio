import { GUID } from "../domain/guid.js";
import type { ProjectRole } from "../domain/types.js";
import type { InvitationStore, ProjectInvitation } from "./types.js";

/** What the invitation store needs of the memory provider's projects. */
export interface InvitationProjects {
  /** `projectId` is lower-case. */
  exists(projectId: string): boolean;
  /** Whether the user has a membership row in the project; both ids are lower-case. */
  isMember(projectId: string, userId: string): boolean;
  /** Adds the membership; both ids are lower-case. */
  addMember(projectId: string, userId: string, role: ProjectRole): void;
}

export interface MemoryInvitations {
  readonly store: InvitationStore;
  /** Drops the invitations of a deleted project. */
  dropProject(projectId: string): void;
}

const lower = (id: string): string => id.toLowerCase();

/**
 * Pending project invitations in process memory (USER_DIRECTORY=local with STORAGE_PROVIDER=memory).
 * The seed's invitations must name projects the memory provider holds.
 */
export function createMemoryInvitations(
  projects: InvitationProjects,
  seed: readonly ProjectInvitation[] = [],
): MemoryInvitations {
  let invitations: ProjectInvitation[] = [];

  const add = (
    invitation: ProjectInvitation,
  ): "added" | "already-invited" | "project-not-found" => {
    const projectId = lower(invitation.projectId);
    if (!GUID.test(projectId) || !projects.exists(projectId)) return "project-not-found";
    const email = lower(invitation.email);
    if (invitations.some((i) => i.projectId === projectId && i.email === email)) {
      return "already-invited";
    }
    invitations.push({
      ...invitation,
      projectId,
      email,
      invitedBy: lower(invitation.invitedBy),
    });
    return "added";
  };
  for (const invitation of seed) {
    if (add(invitation) === "project-not-found") {
      throw new Error(`Invitation refers to unknown project ${invitation.projectId}`);
    }
  }

  const store: InvitationStore = {
    listInvitations: (projectId) =>
      Promise.resolve(
        invitations
          .filter((i) => i.projectId === lower(projectId))
          .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0))
          .map((i) => ({ ...i })),
      ),
    addInvitation: (invitation) => Promise.resolve(add(invitation)),
    removeInvitation: (projectId, email) => {
      const before = invitations.length;
      invitations = invitations.filter(
        (i) => !(i.projectId === lower(projectId) && i.email === lower(email)),
      );
      return Promise.resolve(invitations.length < before ? "removed" : "not-found");
    },
    hasInvitation: (email) => Promise.resolve(invitations.some((i) => i.email === lower(email))),
    claimInvitations: (userId, email) => {
      const user = lower(userId);
      const wanted = lower(email);
      const claimed = invitations.filter((i) => i.email === wanted);
      invitations = invitations.filter((i) => i.email !== wanted);
      let added = 0;
      for (const invitation of claimed) {
        if (projects.isMember(invitation.projectId, user)) continue;
        projects.addMember(invitation.projectId, user, invitation.role);
        added++;
      }
      return Promise.resolve(added);
    },
  };

  return {
    store,
    dropProject: (projectId) => {
      invitations = invitations.filter((i) => i.projectId !== lower(projectId));
    },
  };
}
