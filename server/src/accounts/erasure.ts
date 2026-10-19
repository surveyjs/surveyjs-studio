import { decideMemberErasure, type ErasureFacts } from "../projects/rules.js";
import type { FileStore, MemberErasure, ProjectStore, SurveyStore } from "../providers/types.js";

/**
 * Account erasure (R11): everything the app holds for one user id. Projects come first: the user
 * leaves each one, an admin is promoted where none would remain, and a project with no other
 * member is deleted with its surveys. The personal surveys go last, so a survey a deleted project
 * left behind is deleted too. Results, views, history and themes go with each survey.
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

export function createEraseAccount(stores: ErasureStores, logger?: ErasureLogger): EraseAccount {
  return async (userId, { now }) => {
    const id = checkedUserId(userId);
    let surveysDeleted = 0;
    let projectsLeft = 0;
    let projectsDeleted = 0;
    let adminsPromoted = 0;

    for (const { project } of await projectsOf(stores.projects, id)) {
      const decision = await stores.projects.eraseMember(project.id, id, { now });
      if (decision.kind === "remove" || decision.kind === "promote") projectsLeft += 1;
      if (decision.kind === "promote") adminsPromoted += 1;
      if (decision.kind !== "last-member") continue;
      const scope = { kind: "project", projectId: project.id } as const;
      for (const survey of await stores.surveys.listSurveys(scope)) {
        if (await deleteSurvey(stores, survey.id)) surveysDeleted += 1;
      }
      // A survey added since the listing moves to the erased user and is deleted below.
      await stores.projects.deleteProject(project.id, { receiverId: id, now });
      projectsDeleted += 1;
    }

    for (const survey of await stores.surveys.listSurveys({ kind: "personal", userId: id })) {
      if (await deleteSurvey(stores, survey.id)) surveysDeleted += 1;
    }

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
  const projects: ErasurePreview["projects"][number][] = [];
  for (const { project, role } of await projectsOf(stores.projects, id)) {
    const rows: ErasureFacts[] = (await stores.projects.listMembers(project.id)).map((member) => ({
      userId: member.user.id,
      role: member.role,
      userExists: true,
      displayName: member.user.displayName,
    }));
    rows.push({ userId: id, role, userExists: true, displayName: "" });
    const surveys = await stores.surveys.listSurveys({ kind: "project", projectId: project.id });
    projects.push({
      id: project.id,
      name: project.name,
      decision: decideMemberErasure(rows, id),
      surveyCount: surveys.length,
    });
  }
  const personal = await stores.surveys.listSurveys({ kind: "personal", userId: id });
  return {
    userId: id,
    personalSurveys: personal.map((survey) => ({ id: survey.id, name: survey.name })),
    projects,
  };
}
