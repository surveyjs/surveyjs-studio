import type { ProjectMembership, SurveyOwner, SurveyRecord, User } from "../domain/types.js";
import { projectListOrder, surveyListOrder } from "./ordering.js";
import type { ProviderSet } from "./types.js";

export interface MemorySeed {
  users: User[];
  surveys: SurveyRecord[];
  memberships: { userId: string; membership: ProjectMembership }[];
}

/** Ids are GUIDs: stored lower-case, looked up case-insensitively. */
const lower = (id: string): string => id.toLowerCase();

/** `stored` holds lower-case ids; `wanted` comes from the caller. */
function sameOwner(stored: SurveyOwner, wanted: SurveyOwner): boolean {
  return stored.kind === "personal"
    ? wanted.kind === "personal" && stored.userId === lower(wanted.userId)
    : wanted.kind === "project" && stored.projectId === lower(wanted.projectId);
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
        const found = surveys.find((s) => s.id === lower(id));
        return Promise.resolve(found ? copySurvey(found) : null);
      },
      listSurveys: (owner) =>
        Promise.resolve(
          surveys
            .filter((s) => sameOwner(s.owner, owner))
            .sort(surveyListOrder)
            .map(copySurvey),
        ),
    },
    directory: {
      getUser: (id) => {
        const found = users.find((u) => u.id === lower(id));
        return Promise.resolve(found ? copyUser(found) : null);
      },
      findUserByEmail: (email) => {
        const wanted = email.toLowerCase();
        // A NULL legacy email maps to ""; a blank lookup finds no one (as in azure-legacy).
        if (wanted.trim() === "") return Promise.resolve(null);
        const found = users.find((u) => u.email.toLowerCase() === wanted);
        return Promise.resolve(found ? copyUser(found) : null);
      },
      listUserProjects: (userId) =>
        Promise.resolve(
          memberships
            .filter((m) => m.userId === lower(userId))
            .map((m) => copyMembership(m.membership))
            .sort(projectListOrder),
        ),
    },
    ready: () => Promise.resolve(true),
    close: () => Promise.resolve(),
  };
}
