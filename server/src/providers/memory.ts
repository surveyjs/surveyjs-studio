import type { ProjectMembership, SurveyOwner, SurveyRecord, User } from "../domain/types.js";
import type { ProviderSet } from "./types.js";

export interface MemorySeed {
  users: User[];
  surveys: SurveyRecord[];
  memberships: { userId: string; membership: ProjectMembership }[];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function sameOwner(a: SurveyOwner, b: SurveyOwner): boolean {
  return a.kind === "personal"
    ? b.kind === "personal" && a.userId === b.userId
    : b.kind === "project" && a.projectId === b.projectId;
}

const copySurvey = (s: SurveyRecord): SurveyRecord => structuredClone(s);
const copyUser = (u: User): User => ({ ...u });
const copyMembership = (m: ProjectMembership): ProjectMembership => ({
  project: { ...m.project },
  role: m.role,
});

/** In-memory provider, empty unless a seed is given. Returns copies, so callers cannot change the store. */
export function createMemoryProviders(seed?: MemorySeed): ProviderSet {
  const surveys = (seed?.surveys ?? []).map(copySurvey);
  const users = (seed?.users ?? []).map(copyUser);
  const memberships = (seed?.memberships ?? []).map((m) => ({
    userId: m.userId,
    membership: copyMembership(m.membership),
  }));

  return {
    name: "memory",
    surveys: {
      getSurvey: (id) => {
        const found = surveys.find((s) => s.id === id);
        return Promise.resolve(found ? copySurvey(found) : null);
      },
      listSurveys: (owner) =>
        Promise.resolve(
          surveys
            .filter((s) => sameOwner(s.owner, owner))
            .sort((a, b) => compare(b.updatedAt, a.updatedAt) || compare(a.id, b.id))
            .map(copySurvey),
        ),
    },
    directory: {
      getUser: (id) => {
        const found = users.find((u) => u.id === id);
        return Promise.resolve(found ? copyUser(found) : null);
      },
      findUserByEmail: (email) => {
        const wanted = email.toLowerCase();
        const found = users.find((u) => u.email.toLowerCase() === wanted);
        return Promise.resolve(found ? copyUser(found) : null);
      },
      listUserProjects: (userId) =>
        Promise.resolve(
          memberships
            .filter((m) => m.userId === userId)
            .map((m) => copyMembership(m.membership))
            .sort(
              (a, b) =>
                compare(a.project.name, b.project.name) || compare(a.project.id, b.project.id),
            ),
        ),
    },
    ready: () => Promise.resolve(true),
    close: () => Promise.resolve(),
  };
}
