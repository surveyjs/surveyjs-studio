/**
 * Who and what a run copies before any survey: the projects with their members, the people the
 * copied data names (design, Decisions: people) with their profiles and legacy keys. `copy`
 * writes them; `verify` compares the target against them.
 */
import type { LegacyOrganizationUserRow, LegacyUserRow } from "../providers/azure-legacy/rows.js";
import { isGuid } from "../providers/azure-legacy/mapping.js";
import { mapPeople } from "./map/people.js";
import { mapProject } from "./map/projects.js";
import type { Report } from "./map/report.js";
import { HISTORY_KEEP } from "./map/results.js";
import type { KeyRec, MemberRec, PersonRec, ProjectRec } from "./records.js";
import type { SampleSet } from "./sample.js";
import type { LegacySource } from "./source/index.js";

export type UserRow = LegacyUserRow & { accesskey: string | null; timestamp: Date };

export interface Named {
  /** Every legacy user row (the columns the mapping reads). */
  users: UserRow[];
  /** Every legacy user id, lower-case. */
  legacyUsers: Set<string>;
  /** The projects copied (the sample's only, in a sample), with their members. */
  projects: { project: ProjectRec; members: MemberRec[] }[];
  /** The projects skipped for having no member with a known role (GUID ids only). */
  projectsWithoutMembers: Set<string>;
  /**
   * The change times (`[timestamp]`) of each project's row and of its member rows, by project id:
   * what `verify` judges a project changed after the marks by.
   */
  projectTimes: Map<string, { project: Date | null; members: (Date | null)[] }>;
  /** The lower-case ids of everyone the copied data names. */
  named: Set<string>;
  /** The profiles and keys to pre-create, before the target's own refusals. */
  people: PersonRec[];
  keys: KeyRec[];
}

/**
 * Reads the people and projects, and names everyone the copied data names: project creators and
 * members, survey owners who are people and survey creators, the authors of the copied history
 * (of the surveys `readsHistory` admits), the users with views of the copied surveys, and the
 * key holders (the sample's accounts only, in a sample).
 */
export async function collectNamed(
  source: LegacySource,
  options: {
    sample?: SampleSet;
    report: Report;
    /** `created_at` of the profiles and keys: the run's start. */
    runStart: string;
    /** Whether to name the authors of the survey's history (a listing of its history prefix). */
    readsHistory: (surveyId: string, row: { timestamp: Date | null }) => boolean;
  },
): Promise<Named> {
  const { sample, report } = options;
  const wanted = (surveyId: string) => !sample || sample.surveys.has(surveyId);

  const users: UserRow[] = [];
  const legacyUsers = new Set<string>();
  for await (const row of source.users()) {
    users.push({
      id: row.id,
      email: row.email,
      displayname: row.displayname,
      blocked: row.blocked,
      accesskey: row.accesskey,
      timestamp: row.timestamp,
    });
    legacyUsers.add(row.id.toLowerCase());
  }
  const membersOf = new Map<string, (LegacyOrganizationUserRow & { timestamp: Date | null })[]>();
  for await (const row of source.organizationUsers()) {
    const projectId = row.organizationid.toLowerCase();
    const rows = membersOf.get(projectId);
    if (rows) rows.push(row);
    else membersOf.set(projectId, [row]);
  }
  const projects: { project: ProjectRec; members: MemberRec[] }[] = [];
  const projectsWithoutMembers = new Set<string>();
  const projectTimes: Named["projectTimes"] = new Map();
  for await (const org of source.organizations()) {
    const projectId = org.id.toLowerCase();
    if (sample && !sample.projects.has(projectId)) continue;
    const memberRows = membersOf.get(projectId) ?? [];
    projectTimes.set(projectId, {
      project: org.timestamp,
      members: memberRows.map((row) => row.timestamp),
    });
    const mapped = mapProject(org, memberRows, report);
    if (mapped) projects.push(mapped);
    else if (isGuid(org.id)) projectsWithoutMembers.add(projectId);
  }

  const named = new Set<string>();
  const surveysSeen = new Set<string>();
  for (const { project, members } of projects) {
    if (project.creatorId !== null) named.add(project.creatorId);
    for (const member of members) named.add(member.userId);
  }
  for await (const row of source.surveys()) {
    const surveyId = row.id.toLowerCase();
    if (!wanted(surveyId)) continue;
    surveysSeen.add(surveyId);
    const owner = row.userid?.toLowerCase() ?? "";
    if (legacyUsers.has(owner)) named.add(owner);
    if (row.creatorid !== null) named.add(row.creatorid.toLowerCase());
    if (options.readsHistory(surveyId, row) && isGuid(row.id)) {
      const entries = await source.historyEntries(surveyId);
      for (const entry of entries.slice(0, HISTORY_KEEP)) {
        if (entry.userId !== null) named.add(entry.userId.toLowerCase());
      }
    }
  }
  for await (const view of source.views()) {
    if (surveysSeen.has(view.surveyId.toLowerCase())) named.add(view.userId.toLowerCase());
  }
  for (const row of users) {
    const id = row.id.toLowerCase();
    const key = row.accesskey?.trim() ?? "";
    if (key !== "" && (!sample || sample.accounts.has(id))) named.add(id);
  }

  const { people, keys } = mapPeople(users, named, options.runStart, report);
  return {
    users,
    legacyUsers,
    projects,
    projectsWithoutMembers,
    projectTimes,
    named,
    people,
    keys,
  };
}
