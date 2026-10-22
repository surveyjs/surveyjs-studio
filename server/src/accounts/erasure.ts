import { decideMemberErasure, type ErasureFacts } from "../projects/rules.js";
import type { SurveyOwner } from "../domain/types.js";
import type { FileStore, MemberErasure, ProjectStore, SurveyStore } from "../providers/types.js";

/**
 * Account erasure (R11): everything the app holds for one user id. Projects come first: the user
 * leaves each one, an admin is promoted where none would remain, and a project with no other
 * member is deleted with its surveys. The personal surveys go last, so a survey a deleted project
 * left behind is deleted too. Results, views, history and themes go with each survey.
 *
 * Erasure enumerates by the raw id reads (`listUserProjectIds`, `listSurveyIds`), not by the
 * mapped lists, so it reaches the legacy rows the mapping skips (a NULL role, a NULL `postid` or
 * `resultid`, a membership of a project whose row is gone). Reconciliation reads raw ids too
 * (`listMemberUserIds`, `listPersonalOwnerIds`), so an erased id is not listed again.
 */

export interface ErasureSummary {
  readonly userId: string;
  readonly surveysDeleted: number;
  /** Projects the user left: `remove` and `promote`. */
  readonly projectsLeft: number;
  /** Projects deleted because the user was their last member: `last-member`. */
  readonly projectsDeleted: number;
  /** `promote`. */
  readonly adminsPromoted: number;
}

export interface ErasureStores {
  readonly surveys: SurveyStore;
  readonly projects: ProjectStore;
  readonly files: FileStore;
}

/** Pino-compatible (Fastify's `app.log` fits). Receives ids and counts only. */
export interface ErasureLogger {
  info(details: Readonly<Record<string, string | number>>, message: string): void;
}

/** R11's signature: `eraseAccount(userId, { now })`. */
export type EraseAccount = (
  userId: string,
  options: { readonly now: string },
) => Promise<ErasureSummary>;

export interface ErasurePreview {
  readonly userId: string;
  readonly personalSurveys: readonly { readonly id: string; readonly name: string }[];
  readonly projects: readonly {
    readonly id: string;
    /** "" when the user's row in it cannot be read (an unknown role, or the project row is gone). */
    readonly name: string;
    readonly decision: MemberErasure;
    /** Surveys of the project (deleted with it on `last-member`). */
    readonly surveyCount: number;
  }[];
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id in lower case; refuses anything but a GUID. */
function checkedUserId(userId: string): string {
  if (!GUID.test(userId)) throw new Error("Erasure needs a user GUID");
  return userId.toLowerCase();
}

/** The user's projects, each once (a user with duplicate rows is listed once per row). */
async function projectsOf(projects: ProjectStore, userId: string) {
  const seen = new Set<string>();
  return (await projects.listUserProjects(userId)).filter((membership) => {
    if (seen.has(membership.project.id)) return false;
    seen.add(membership.project.id);
    return true;
  });
}

/** Deletes the survey's files, then the survey (no archive rule, no permission check). */
async function deleteSurvey(stores: ErasureStores, surveyId: string): Promise<boolean> {
  await stores.files.deleteSurveyFiles(surveyId);
  return stores.surveys.deleteSurvey(surveyId);
}

/** Deletes every survey of the owner, also rows the mapping skips; returns how many were deleted. */
async function deleteSurveysOf(stores: ErasureStores, owner: SurveyOwner): Promise<number> {
  let deleted = 0;
  for (const surveyId of await stores.surveys.listSurveyIds(owner)) {
    if (await deleteSurvey(stores, surveyId)) deleted += 1;
  }
  return deleted;
}

export function createEraseAccount(stores: ErasureStores, logger?: ErasureLogger): EraseAccount {
  return async (userId, { now }) => {
    const id = checkedUserId(userId);
    let surveysDeleted = 0;
    let projectsLeft = 0;
    let projectsDeleted = 0;
    let adminsPromoted = 0;

    for (const projectId of await stores.projects.listUserProjectIds(id)) {
      const decision = await stores.projects.eraseMember(projectId, id, { now });
      if (decision.kind === "remove" || decision.kind === "promote") projectsLeft += 1;
      if (decision.kind === "promote") adminsPromoted += 1;
      if (decision.kind !== "last-member") continue;
      surveysDeleted += await deleteSurveysOf(stores, { kind: "project", projectId });
      // A survey added since the listing moves to the erased user and is deleted below.
      await stores.projects.deleteProject(projectId, { receiverId: id, now });
      projectsDeleted += 1;
    }

    surveysDeleted += await deleteSurveysOf(stores, { kind: "personal", userId: id });

    const summary: ErasureSummary = {
      userId: id,
      surveysDeleted,
      projectsLeft,
      projectsDeleted,
      adminsPromoted,
    };
    logger?.info({ ...summary }, "Erased the data of an account.");
    return summary;
  };
}

/** What `eraseAccount` would do, read only (for the CLI's dry run). The store decides again when erasing. */
export async function previewErasure(
  stores: ErasureStores,
  userId: string,
): Promise<ErasurePreview> {
  const id = checkedUserId(userId);
  // The readable memberships in list order, then the projects of rows that cannot be read: the
  // same projects eraseAccount goes through.
  const readable = await projectsOf(stores.projects, id);
  const names = new Map(readable.map(({ project }) => [project.id, project.name]));
  const projectIds = [
    ...names.keys(),
    ...(await stores.projects.listUserProjectIds(id)).filter((projectId) => !names.has(projectId)),
  ];
  const projects: ErasurePreview["projects"][number][] = [];
  for (const projectId of projectIds) {
    const rows: ErasureFacts[] = (await stores.projects.listMembers(projectId)).map((member) => ({
      userId: member.user.id,
      role: member.role,
      userExists: true,
      displayName: member.user.displayName,
    }));
    // The erased user's own role does not change the decision.
    rows.push({ userId: id, role: null, userExists: true, displayName: "" });
    const surveyIds = await stores.surveys.listSurveyIds({ kind: "project", projectId });
    projects.push({
      id: projectId,
      name: names.get(projectId) ?? "",
      decision: decideMemberErasure(rows, id),
      surveyCount: surveyIds.length,
    });
  }
  // Readable surveys in list order with their names, then the ids of rows that cannot be read.
  const personal = await stores.surveys.listSurveys({ kind: "personal", userId: id });
  const listed = new Set(personal.map((survey) => survey.id));
  const unreadable = (await stores.surveys.listSurveyIds({ kind: "personal", userId: id }))
    .filter((surveyId) => !listed.has(surveyId))
    .map((surveyId) => ({ id: surveyId, name: "" }));
  return {
    userId: id,
    personalSurveys: [
      ...personal.map((survey) => ({ id: survey.id, name: survey.name })),
      ...unreadable,
    ],
    projects,
  };
}
