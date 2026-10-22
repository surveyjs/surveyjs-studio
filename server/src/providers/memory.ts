import type { AccountNoticesSetting } from "../config.js";
import type {
  NewSurvey,
  ProjectMember,
  ProjectMembership,
  ProjectRecord,
  ProjectRole,
  SaveOutcome,
  SurveyDefinition,
  SurveyOwner,
  SurveyRecord,
  SurveyResponse,
  SurveyTheme,
  User,
  Versioned,
  ViewName,
} from "../domain/types.js";
import { randomUUID } from "node:crypto";
import { contentVersion } from "../domain/content-version.js";
import { applySurveyChanges } from "../domain/survey-changes.js";
import { demoAccountNotices } from "../notices/account-notices.js";
import {
  decideMemberErasure,
  decideRemoval,
  decideRoleChange,
  isAdminRole,
  type ErasureFacts,
  type MembershipFacts,
} from "../projects/rules.js";
import {
  historyOrder,
  isAfter,
  isAfterHistory,
  memberListOrder,
  projectListOrder,
  surveyListOrder,
} from "./ordering.js";
import { createMemoryFileStore } from "./memory-files.js";
import { createMemoryResultStore } from "./memory-results.js";
import { createMemoryViewStore } from "./memory-views.js";
import type { ProviderSet } from "./types.js";
import { GUID } from "../domain/guid.js";

/**
 * A stored project. `ownerId` and `memberCount` are worked out from `memberships` at read time:
 * the owner is `creatorId` while that user still has a membership (R2), else null.
 */
export interface MemorySeedProject {
  id: string;
  name: string;
  creatorId: string | null;
  createdAt: string;
}

export interface MemorySeed {
  users: User[];
  surveys: SurveyRecord[];
  projects: MemorySeedProject[];
  memberships: { userId: string; projectId: string; role: ProjectRole }[];
  /** Survey definitions by survey id. */
  definitions?: Record<string, SurveyDefinition>;
  /** Survey themes by survey id. */
  themes?: Record<string, SurveyTheme>;
  /** History entries (with their snapshots) by survey id. */
  history?: Record<string, { id: string; at: string; userId: null; snapshot: SurveyDefinition }[]>;
  /** Stored responses by survey id (S15). */
  responses?: Record<string, SurveyResponse[]>;
  /** Completion markers by survey id, then client id (S15). */
  completions?: Record<string, Record<string, { partial: boolean }>>;
  /** The legacy per-survey layouts by survey id, the fallback of `getView` (Step 9). */
  legacyViews?: Record<string, Partial<Record<ViewName, Record<string, unknown>>>>;
  /** The names of the questions hidden from public results, by survey id (Step 10). */
  privateResultQuestions?: Record<string, string[]>;
}

interface StoredHistoryEntry {
  readonly id: string;
  readonly at: string;
  readonly userId: string | null;
  readonly snapshot: SurveyDefinition;
}

/** The version of a stored document: the hash of its compact JSON, or of "" when none is stored. */
const versionOf = (content: Record<string, unknown> | undefined): string =>
  contentVersion(content === undefined ? "" : JSON.stringify(content));

export interface MemoryOptions {
  /** `ACCOUNT_NOTICES`; default `none`. Only the demo settings: the memory store has no licences. */
  readonly accountNotices?: AccountNoticesSetting;
}

/** Ids are GUIDs: stored lower-case, looked up case-insensitively. */
const lower = (id: string): string => id.toLowerCase();

const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

/** Distinct values in ascending code-point order. */
const distinctSorted = (values: readonly string[]): string[] => [...new Set(values)].sort();

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
  const projects = new Map<string, MemorySeedProject>(
    (seed?.projects ?? []).map((p) => [
      lower(p.id),
      { ...p, id: lower(p.id), creatorId: p.creatorId === null ? null : lower(p.creatorId) },
    ]),
  );
  let memberships = (seed?.memberships ?? []).map((m) => {
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

  const history = new Map<string, StoredHistoryEntry[]>(
    Object.entries(seed?.history ?? {}).map(([id, entries]) => [
      lower(id),
      entries.map((e) => ({ ...e, id: lower(e.id), snapshot: structuredClone(e.snapshot) })),
    ]),
  );
  const addHistory = (surveyId: string, entry: StoredHistoryEntry): void => {
    const entries = history.get(surveyId) ?? [];
    entries.push({ ...entry, snapshot: structuredClone(entry.snapshot) });
    history.set(surveyId, entries);
  };

  const results = createMemoryResultStore({
    ...(seed?.responses && { responses: seed.responses }),
    ...(seed?.completions && { completions: seed.completions }),
  });

  const views = createMemoryViewStore({
    ...(seed?.legacyViews && { legacyViews: seed.legacyViews }),
    ...(seed?.privateResultQuestions && { privateResultQuestions: seed.privateResultQuestions }),
  });

  const findSurvey = (id: string) => surveys.find((s) => s.id === lower(id));

  /** Stores a new survey; throws on a duplicate id. */
  const add = (survey: NewSurvey, definition: SurveyDefinition | undefined): SurveyRecord => {
    const record = surveyFromNew(survey);
    if (findSurvey(record.id)) throw new Error(`survey ${record.id} already exists`);
    surveys.push(record);
    if (definition !== undefined) {
      definitions.set(record.id, structuredClone(definition));
      addHistory(record.id, {
        id: randomUUID(),
        at: record.createdAt,
        userId: record.creatorId,
        snapshot: definition,
      });
    }
    return copySurvey(record);
  };

  /** A document and its version; null when no survey has this id. */
  const read = (
    id: string,
    store: Map<string, Record<string, unknown>>,
  ): Versioned<Record<string, unknown>> | null => {
    if (!findSurvey(id)) return null;
    const stored = store.get(lower(id));
    return { content: structuredClone(stored ?? {}), version: versionOf(stored) };
  };

  /** Compare-and-set of one document; moves the survey's updatedAt on success. */
  const write = (
    id: string,
    store: Map<string, Record<string, unknown>>,
    content: Record<string, unknown>,
    ifVersion: string,
    savedAt: string,
  ): SaveOutcome => {
    const index = surveys.findIndex((s) => s.id === lower(id));
    if (index < 0) return { kind: "not-found" };
    const key = surveys[index]!.id;
    if (versionOf(store.get(key)) !== ifVersion) return { kind: "conflict" };
    const stored = structuredClone(content);
    store.set(key, stored);
    surveys[index] = { ...surveys[index]!, updatedAt: savedAt };
    return { kind: "saved", version: versionOf(stored) };
  };

  const membershipsOf = (projectId: string) => memberships.filter((m) => m.projectId === projectId);

  /** The project as stored now: the owner while the creator is a member (R2), every row counted. */
  const projectRecord = (projectId: string): ProjectRecord => {
    const { id, name, creatorId, createdAt } = projects.get(projectId)!;
    const rows = membershipsOf(projectId);
    const ownerId = rows.some((m) => m.userId === creatorId) ? creatorId : null;
    return { id, name, ownerId, createdAt, memberCount: rows.length };
  };

  /** A fresh membership with the project's current owner and member count. */
  const membershipOf = (m: (typeof memberships)[number]): ProjectMembership => ({
    project: projectRecord(m.projectId),
    role: m.role,
  });

  const findUser = (id: string) => users.find((u) => u.id === lower(id));

  /** The project's rows as the last-admin rule sees them (R8, R11). */
  const factsOf = (projectId: string): MembershipFacts[] =>
    membershipsOf(projectId).map((m) => ({
      userId: m.userId,
      role: m.role,
      userExists: findUser(m.userId) !== undefined,
    }));

  /** The project's rows as the erasure rule sees them (R11), with the names listMembers shows. */
  const erasureFactsOf = (projectId: string): ErasureFacts[] =>
    factsOf(projectId).map((facts) => ({
      ...facts,
      displayName: findUser(facts.userId)?.displayName ?? "",
    }));

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
      getDefinition: (id) => Promise.resolve(read(id, definitions)),
      getTheme: (id) => Promise.resolve(read(id, themes)),
      saveDefinition: (id, definition, { ifVersion, userId, savedAt }) => {
        const outcome = write(id, definitions, definition, ifVersion, savedAt);
        if (outcome.kind === "saved") {
          addHistory(lower(id), {
            id: randomUUID(),
            at: savedAt,
            userId: lower(userId),
            snapshot: definition,
          });
        }
        return Promise.resolve(outcome);
      },
      saveTheme: (id, theme, { ifVersion, savedAt }) =>
        Promise.resolve(write(id, themes, theme, ifVersion, savedAt)),
      listHistory: ({ surveyId, after, limit }) => {
        const matching = [...(history.get(lower(surveyId)) ?? [])]
          .sort(historyOrder)
          .filter((e) => !after || isAfterHistory(e, after));
        const items = matching.slice(0, limit).map(({ id, at, userId }) => ({ id, at, userId }));
        const last = items.at(-1);
        return Promise.resolve({
          items,
          next: matching.length > items.length && last ? { at: last.at, id: last.id } : null,
        });
      },
      getHistorySnapshot: (surveyId, entryId) => {
        const found = history.get(lower(surveyId))?.find((e) => e.id === lower(entryId));
        return Promise.resolve(found ? structuredClone(found.snapshot) : null);
      },
      updateSurvey: (id, changes) => {
        const index = surveys.findIndex((s) => s.id === lower(id));
        if (index < 0) return Promise.resolve(null);
        const updated = applySurveyChanges(surveys[index]!, changes);
        surveys[index] = updated;
        return Promise.resolve(copySurvey(updated));
      },
      cloneSurvey: (sourceId, copy, options) => {
        const source = findSurvey(sourceId);
        if (!source) return Promise.resolve(null);
        const rewrite = options?.rewriteText;
        const rewritten = (doc: Record<string, unknown> | undefined) =>
          doc === undefined || !rewrite
            ? doc
            : (JSON.parse(rewrite(JSON.stringify(doc))) as Record<string, unknown>);
        try {
          const stored = add(copy, rewritten(definitions.get(source.id)));
          const theme = rewritten(themes.get(source.id));
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
        history.delete(removed!.id);
        themes.delete(removed!.id);
        results.dropSurvey(removed!.id);
        views.dropSurvey(removed!.id);
        return Promise.resolve(true);
      },
      listPersonalOwnerIds: () =>
        Promise.resolve(
          distinctSorted(
            surveys
              .flatMap((s) => (s.owner.kind === "personal" ? [s.owner.userId] : []))
              .filter((id) => GUID.test(id) && id !== ZERO_GUID),
          ),
        ),
      // Every memory survey maps, so these are the ids of listSurveys.
      listSurveyIds: (owner) =>
        Promise.resolve(
          GUID.test(owner.kind === "personal" ? owner.userId : owner.projectId)
            ? surveys
                .filter((s) => sameOwner(s.owner, owner))
                .map((s) => s.id)
                .sort()
            : [],
        ),
    },
    files: createMemoryFileStore(),
    results: results.store,
    views: views.store,
    users: {
      kind: "external",
      getUser: (id) => {
        const found = findUser(id);
        return Promise.resolve(found ? copyUser(found) : null);
      },
      findUserByEmail: (email) => {
        const wanted = email.toLowerCase();
        // A NULL legacy email maps to ""; a blank lookup finds no one (as in azure-legacy).
        if (wanted.trim() === "") return Promise.resolve(null);
        const found = users.find((u) => u.email.toLowerCase() === wanted);
        return Promise.resolve(found ? copyUser(found) : null);
      },
      // An external directory never creates a user: the caller falls back to the claims.
      signInUser: (claims) => {
        const found = findUser(claims.sub);
        return Promise.resolve(found ? copyUser(found) : null);
      },
      missingUsers: (ids) => {
        const asked = [...new Set(ids.filter((id) => GUID.test(id)).map(lower))];
        return Promise.resolve(asked.filter((id) => findUser(id) === undefined));
      },
    },
    projects: {
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
      listMembers: (projectId) => {
        const byUser = new Map<string, ProjectMember>();
        for (const m of membershipsOf(lower(projectId))) {
          const user = findUser(m.userId);
          if (!user) continue; // an orphan row is not shown (R11)
          const admin = isAdminRole(m.role) || byUser.get(user.id)?.role === "admin";
          byUser.set(user.id, { user: copyUser(user), role: admin ? "admin" : "user" });
        }
        return Promise.resolve([...byUser.values()].sort(memberListOrder));
      },
      createProject: ({ id, name, creatorId, createdAt }) => {
        const key = lower(id);
        if (!GUID.test(key)) return Promise.reject(new Error("Project ids must be GUIDs"));
        if (projects.has(key)) return Promise.reject(new Error(`project ${key} already exists`));
        const creator = { userId: lower(creatorId), projectId: key, role: "admin" as const };
        projects.set(key, { id: key, name, creatorId: creator.userId, createdAt });
        memberships.push(creator);
        return Promise.resolve(membershipOf(creator));
      },
      renameProject: (projectId, name) => {
        const project = projects.get(lower(projectId));
        if (!project) return Promise.resolve(false);
        projects.set(project.id, { ...project, name });
        return Promise.resolve(true);
      },
      deleteProject: (projectId, { receiverId, now }) => {
        const key = lower(projectId);
        if (!projects.has(key)) return Promise.resolve(null);
        const moved: string[] = [];
        surveys.forEach((survey, index) => {
          if (survey.owner.kind !== "project" || survey.owner.projectId !== key) return;
          // Not applySurveyChanges: its move makes the mover the creator; the cascade keeps it (R9).
          const owner: SurveyOwner = { kind: "personal", userId: lower(receiverId) };
          surveys[index] = { ...survey, owner, updatedAt: now };
          moved.push(survey.id);
        });
        memberships = memberships.filter((m) => m.projectId !== key);
        projects.delete(key);
        return Promise.resolve(moved.sort());
      },
      addMember: (projectId, userId, role) => {
        const key = lower(projectId);
        if (!projects.has(key)) return Promise.resolve("not-found");
        const user = lower(userId);
        if (membershipsOf(key).some((m) => m.userId === user)) {
          return Promise.resolve("already-member");
        }
        memberships.push({ userId: user, projectId: key, role });
        return Promise.resolve("added");
      },
      setMemberRole: (projectId, userId, role) => {
        const key = lower(projectId);
        if (!projects.has(key)) return Promise.resolve("not-found");
        const outcome = decideRoleChange(factsOf(key), userId, role);
        if (outcome === "changed") {
          const user = lower(userId);
          memberships = memberships.map((m) =>
            m.projectId === key && m.userId === user ? { ...m, role } : m,
          );
        }
        return Promise.resolve(outcome);
      },
      removeMember: (projectId, userId) => {
        const key = lower(projectId);
        const project = projects.get(key);
        if (!project) return Promise.resolve("not-found");
        const outcome = decideRemoval(factsOf(key), userId);
        if (outcome === "removed") {
          const user = lower(userId);
          memberships = memberships.filter((m) => !(m.projectId === key && m.userId === user));
          // The creator marker goes with the creator, as the legacy creator row does: a creator
          // who is added again is not the owner again (R2).
          if (project.creatorId === user) projects.set(key, { ...project, creatorId: null });
        }
        return Promise.resolve(outcome);
      },
      eraseMember: (projectId, userId) => {
        const key = lower(projectId);
        const project = projects.get(key);
        if (!project || !GUID.test(userId)) return Promise.resolve({ kind: "not-member" });
        const decision = decideMemberErasure(erasureFactsOf(key), userId);
        if (decision.kind === "remove" || decision.kind === "promote") {
          const user = lower(userId);
          memberships = memberships.filter((m) => !(m.projectId === key && m.userId === user));
          if (decision.kind === "promote") {
            memberships = memberships.map((m) =>
              m.projectId === key && m.userId === decision.successorId
                ? { ...m, role: "admin" }
                : m,
            );
          }
          // As in removeMember: the owner goes with the creator (R2).
          if (project.creatorId === user) projects.set(key, { ...project, creatorId: null });
        }
        return Promise.resolve(decision);
      },
      listMemberUserIds: () => Promise.resolve(distinctSorted(memberships.map((m) => m.userId))),
      // Memory holds no membership of a missing project: the seed refuses one and deleteProject
      // drops a project's rows with it.
      listUserProjectIds: (userId) =>
        Promise.resolve(
          GUID.test(userId)
            ? distinctSorted(
                memberships.filter((m) => m.userId === lower(userId)).map((m) => m.projectId),
              )
            : [],
        ),
    },
    notices,
    readinessNames: ["memory"],
    ready: () => Promise.resolve([{ name: "memory", ok: true }]),
    close: () => Promise.resolve(),
  };
}
