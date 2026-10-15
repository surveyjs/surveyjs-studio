import type { AccountNoticesSetting } from "../config.js";
import type {
  NewSurvey,
  ProjectMembership,
  ProjectRecord,
  ProjectRole,
  SurveyDefinition,
  SurveyOwner,
  SurveyRecord,
  SurveyTheme,
  User,
} from "../domain/types.js";
import { applySurveyChanges } from "../domain/survey-changes.js";
import { demoAccountNotices } from "../notices/account-notices.js";
import { isAfter, projectListOrder, surveyListOrder } from "./ordering.js";
import type { ProviderSet } from "./types.js";

export interface MemorySeed {
  users: User[];
  surveys: SurveyRecord[];
  /** `memberCount` is counted from `memberships` at read time. */
  projects: Omit<ProjectRecord, "memberCount">[];
  memberships: { userId: string; projectId: string; role: ProjectRole }[];
  /** Survey definitions by survey id. */
  definitions?: Record<string, SurveyDefinition>;
  /** Survey themes by survey id. */
  themes?: Record<string, SurveyTheme>;
}

export interface MemoryOptions {
  /** `ACCOUNT_NOTICES`; default `none`. Only the demo settings: the memory store has no licences. */
  readonly accountNotices?: AccountNoticesSetting;
}

/** Ids are GUIDs: stored lower-case, looked up case-insensitively. */
const lower = (id: string): string => id.toLowerCase();

const lowerOwner = (owner: SurveyOwner): SurveyOwner =>
  owner.kind === "personal"
    ? { kind: "personal", userId: lower(owner.userId) }
    : { kind: "project", projectId: lower(owner.projectId) };

/** `stored` holds lower-case ids; `wanted` comes from the caller. */
function sameOwner(stored: SurveyOwner, wanted: SurveyOwner): boolean {
  return stored.kind === "personal"
    ? wanted.kind === "personal" && stored.userId === lower(wanted.userId)
    : wanted.kind === "project" && stored.projectId === lower(wanted.projectId);
}

const copySurvey = (s: SurveyRecord): SurveyRecord => structuredClone(s);
const copyUser = (u: User): User => ({ ...u });

/** A stored survey for a new one: the legacy defaults (layout section 5.3) and lower-case ids. */
const surveyFromNew = (survey: NewSurvey): SurveyRecord => ({
  id: lower(survey.id),
  name: survey.name,
  owner: lowerOwner(survey.owner),
  creatorId: lower(survey.creatorId),
  postId: lower(survey.postId),
  resultId: lower(survey.resultId),
  published: false,
  archived: false,
  createdAt: survey.createdAt,
  updatedAt: survey.updatedAt,
  settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
});

/** In-memory provider, empty unless a seed is given. Returns copies, so callers cannot change the store. */
export function createMemoryProviders(seed?: MemorySeed, options: MemoryOptions = {}): ProviderSet {
  const accountNotices = options.accountNotices ?? "none";
  if (accountNotices === "surveyjs-licenses") {
    throw new Error("ACCOUNT_NOTICES=surveyjs-licenses needs STORAGE_PROVIDER=azure-legacy");
  }
  const notices = demoAccountNotices(accountNotices);
  const surveys = (seed?.surveys ?? []).map(copySurvey);
  const users = (seed?.users ?? []).map(copyUser);
  const projects = new Map(
    (seed?.projects ?? []).map((p) => [lower(p.id), { ...p, id: lower(p.id) }] as const),
  );
  const memberships = (seed?.memberships ?? []).map((m) => {
    if (!projects.has(lower(m.projectId))) {
      throw new Error(`Membership refers to unknown project ${m.projectId}`);
    }
    return { userId: lower(m.userId), projectId: lower(m.projectId), role: m.role };
  });
  const definitions = new Map(
    Object.entries(seed?.definitions ?? {}).map(([id, d]) => [lower(id), structuredClone(d)]),
  );

  const themes = new Map(
    Object.entries(seed?.themes ?? {}).map(([id, t]) => [lower(id), structuredClone(t)]),
  );

  const findSurvey = (id: string) => surveys.find((s) => s.id === lower(id));

  /** Stores a new survey; throws on a duplicate id. */
  const add = (survey: NewSurvey, definition: SurveyDefinition | undefined): SurveyRecord => {
    const record = surveyFromNew(survey);
    if (findSurvey(record.id)) throw new Error(`survey ${record.id} already exists`);
    surveys.push(record);
    if (definition !== undefined) definitions.set(record.id, structuredClone(definition));
    return copySurvey(record);
  };

  /** A fresh membership with the project's current member count. */
  const membershipOf = (m: (typeof memberships)[number]): ProjectMembership => {
    const project = projects.get(m.projectId)!;
    const memberCount = memberships.filter((other) => other.projectId === m.projectId).length;
    return { project: { ...project, memberCount }, role: m.role };
  };

  return {
    name: "memory",
    surveys: {
      getSurvey: (id) => {
        const found = findSurvey(id);
        return Promise.resolve(found ? copySurvey(found) : null);
      },
      listSurveys: (owner) =>
        Promise.resolve(
          surveys
            .filter((s) => sameOwner(s.owner, owner))
            .sort(surveyListOrder)
            .map(copySurvey),
        ),
      listSurveyPage: ({ owner, archived, after, limit }) => {
        const matching = surveys
          .filter((s) => sameOwner(s.owner, owner) && s.archived === archived)
          .filter((s) => !after || isAfter(s, after))
          .sort(surveyListOrder);
        const items = matching.slice(0, limit);
        const last = items.at(-1);
        return Promise.resolve({
          items: items.map(copySurvey),
          next:
            matching.length > items.length && last
              ? { updatedAt: last.updatedAt, id: last.id }
              : null,
        });
      },
      createSurvey: (survey, definition) => {
        try {
          return Promise.resolve(add(survey, definition));
        } catch (error) {
          return Promise.reject(error as Error);
        }
      },
      getDefinition: (id) => {
        if (!findSurvey(id)) return Promise.resolve(null);
        return Promise.resolve(structuredClone(definitions.get(lower(id)) ?? {}));
      },
      getTheme: (id) => {
        if (!findSurvey(id)) return Promise.resolve(null);
        return Promise.resolve(structuredClone(themes.get(lower(id)) ?? {}));
      },
      updateSurvey: (id, changes) => {
        const index = surveys.findIndex((s) => s.id === lower(id));
        if (index < 0) return Promise.resolve(null);
        const updated = applySurveyChanges(surveys[index]!, changes);
        surveys[index] = updated;
        return Promise.resolve(copySurvey(updated));
      },
      cloneSurvey: (sourceId, copy) => {
        const source = findSurvey(sourceId);
        if (!source) return Promise.resolve(null);
        try {
          const stored = add(copy, definitions.get(source.id));
          const theme = themes.get(source.id);
          if (theme !== undefined) themes.set(stored.id, structuredClone(theme));
          return Promise.resolve(stored);
        } catch (error) {
          return Promise.reject(error as Error);
        }
      },
      deleteSurvey: (id) => {
        const index = surveys.findIndex((s) => s.id === lower(id));
        if (index < 0) return Promise.resolve(false);
        const [removed] = surveys.splice(index, 1);
        definitions.delete(removed!.id);
        themes.delete(removed!.id);
        return Promise.resolve(true);
      },
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
            .map(membershipOf)
            .sort(projectListOrder),
        ),
      getUserProject: (userId, projectId) => {
        const found = memberships.find(
          (m) => m.userId === lower(userId) && m.projectId === lower(projectId),
        );
        return Promise.resolve(found ? membershipOf(found) : null);
      },
    },
    notices,
    ready: () => Promise.resolve(true),
    close: () => Promise.resolve(),
  };
}
