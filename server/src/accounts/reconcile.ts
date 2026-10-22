import type { ProjectStore, SurveyStore, UserDirectory } from "../providers/types.js";

export interface ReconcileStores {
  readonly surveys: SurveyStore;
  readonly projects: ProjectStore;
  readonly users: UserDirectory;
}

/** Ascending code-point order. */
const ascending = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * R12: the ids that own personal surveys or hold memberships but that the user directory
 * positively does not know, ascending. They are owners the directory does not know, not
 * necessarily people: the id of a deleted project whose surveys still point at it is one too.
 * Rejects when the directory fails (a failure is never read as "missing").
 */
export async function findErasureCandidates(stores: ReconcileStores): Promise<string[]> {
  const owners = await stores.surveys.listPersonalOwnerIds();
  const members = await stores.projects.listMemberUserIds();
  const ids = [...new Set([...owners, ...members])].sort(ascending);
  return [...(await stores.users.missingUsers(ids))].sort(ascending);
}
