// Makes the sandbox seed (web/src/sandbox/seed.json) from the shared golden fixtures: the legacy
// fixture seed plus the seed invitation (the same seed MEMORY_SEED=legacy-fixtures loads with a
// local directory), restricted by the tag file server/fixtures/sandbox.json. Runs in Node at
// development time; the web gets only the generated JSON and web/src/sandbox/seed-types.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { legacyFixtureSeed } from "../../server/src/providers/azure-legacy/fixtures.js";
import type { MemorySeed } from "../../server/src/providers/memory.js";
import { withSeedInvitation } from "../../server/src/providers/seed-invitations.js";
import type { SandboxSeed } from "../../web/src/sandbox/seed-types.js";

const root = resolve(import.meta.dirname, "../..");
export const tagFilePath = resolve(root, "server/fixtures/sandbox.json");

interface Tags {
  users: string[];
  surveys: string[];
  projects: string[];
}

const readTags = (): Tags => {
  const tags = JSON.parse(readFileSync(tagFilePath, "utf8")) as Partial<Tags>;
  const list = (name: keyof Tags): string[] => {
    const value = tags[name];
    if (!Array.isArray(value)) throw new Error(`${tagFilePath}: "${name}" must be a list of ids`);
    return value.map((id) => id.toLowerCase());
  };
  return { users: list("users"), surveys: list("surveys"), projects: list("projects") };
};

/** The entries of a by-survey-id map whose key is tagged, in id order. */
const bySurvey = <T>(map: Record<string, T> | undefined, surveys: Set<string>): Record<string, T> =>
  Object.fromEntries(
    Object.entries(map ?? {})
      .filter(([id]) => surveys.has(id.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b)),
  );

const byId = <T extends { id: string }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => a.id.localeCompare(b.id));

export async function sandboxSeed(): Promise<SandboxSeed> {
  const tags = readTags();
  const users = new Set(tags.users);
  const surveys = new Set(tags.surveys);
  const projects = new Set(tags.projects);
  const seed: MemorySeed = withSeedInvitation(await legacyFixtureSeed());

  const keptSurveys = seed.surveys.filter((s) => surveys.has(s.id.toLowerCase()));
  const keptMemberships = seed.memberships.filter(
    (m) => users.has(m.userId.toLowerCase()) && projects.has(m.projectId.toLowerCase()),
  );
  const keptInvitations = (seed.invitations ?? []).filter(
    (i) => projects.has(i.projectId.toLowerCase()) && users.has(i.invitedBy.toLowerCase()),
  );
  const responses = bySurvey(seed.responses, surveys);

  return {
    version: 1,
    users: byId(seed.users.filter((u) => users.has(u.id.toLowerCase()))).map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      blocked: u.blocked,
    })),
    projects: byId(seed.projects.filter((p) => projects.has(p.id.toLowerCase()))).map((p) => ({
      id: p.id,
      name: p.name,
      creatorId: p.creatorId !== null && users.has(p.creatorId.toLowerCase()) ? p.creatorId : null,
      createdAt: p.createdAt,
    })),
    memberships: keptMemberships
      .map((m) => ({ userId: m.userId, projectId: m.projectId, role: m.role }))
      .sort((a, b) => a.projectId.localeCompare(b.projectId) || a.userId.localeCompare(b.userId)),
    invitations: keptInvitations.map((i) => ({
      projectId: i.projectId,
      email: i.email,
      role: i.role,
      invitedBy: i.invitedBy,
      createdAt: i.createdAt,
    })),
    surveys: byId(keptSurveys).map((s) => ({
      id: s.id,
      name: s.name,
      owner:
        s.owner.kind === "personal"
          ? { kind: "personal", userId: s.owner.userId }
          : { kind: "project", projectId: s.owner.projectId },
      creatorId: s.creatorId,
      postId: s.postId,
      resultId: s.resultId,
      published: s.published,
      archived: s.archived,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      settings: {
        publicResults: s.settings.publicResults,
        storeRespondentIp: s.settings.storeRespondentIp,
        useCookies: s.settings.useCookies,
      },
    })),
    definitions: bySurvey(seed.definitions, surveys),
    themes: bySurvey(seed.themes, surveys),
    history: bySurvey(seed.history, surveys),
    responses: Object.fromEntries(
      Object.entries(responses).map(([id, list]) => [
        id,
        list.map((r) => ({
          id: r.id,
          submittedAt: r.submittedAt,
          data: r.data,
          ...(r.clientId === undefined ? {} : { clientId: r.clientId }),
          ...(r.respondentIp === undefined ? {} : { respondentIp: r.respondentIp }),
          partial: r.partial,
        })),
      ]),
    ),
    completions: bySurvey(seed.completions, surveys),
    legacyViews: bySurvey(seed.legacyViews, surveys),
    privateResultQuestions: bySurvey(seed.privateResultQuestions, surveys),
  };
}

/** The file's text: the seed's own key order, 2-space indent, a trailing newline. */
export const seedJson = (seed: SandboxSeed): string => `${JSON.stringify(seed, null, 2)}\n`;
