// Who may see and modify a survey, and the scope a request names. Mirrors server/src/surveys/
// permissions.ts (who may see and modify) and access.ts (404 then 403). The sandbox code does not
// import server/src.
import type { SandboxMembership, SandboxSurvey, SandboxUser } from "../seed-types";
import type { SandboxData } from "../store";
import { checkPathId, lower, sameId } from "./common";
import { forbidden, notFound } from "./problems";

/** The `project` of a survey list that names the user's personal surveys. */
export const PERSONAL = "personal";

/** The user's membership of a project, or null. */
export function membershipOf(
  data: SandboxData,
  userId: string,
  projectId: string,
): SandboxMembership | null {
  return (
    data.memberships.find((m) => sameId(m.userId, userId) && sameId(m.projectId, projectId)) ?? null
  );
}

/** The membership that counts for a survey: of its project, for a project survey. */
export function surveyMembership(
  data: SandboxData,
  user: SandboxUser,
  survey: SandboxSurvey,
): SandboxMembership | null {
  return survey.owner.kind === "project"
    ? membershipOf(data, user.id, survey.owner.projectId)
    : null;
}

/** Personal: its owner. Project: any member. */
export function canSee(
  survey: SandboxSurvey,
  user: SandboxUser,
  membership: SandboxMembership | null,
): boolean {
  return survey.owner.kind === "personal"
    ? sameId(survey.owner.userId, user.id)
    : membership !== null && sameId(membership.projectId, survey.owner.projectId);
}

/** Personal: its owner. Project: a project admin, or the survey's creator. */
export function canModify(
  survey: SandboxSurvey,
  user: SandboxUser,
  membership: SandboxMembership | null,
): boolean {
  if (survey.owner.kind === "personal") return sameId(survey.owner.userId, user.id);
  if (membership === null || !sameId(membership.projectId, survey.owner.projectId)) return false;
  return (
    membership.role === "admin" || (survey.creatorId !== null && sameId(survey.creatorId, user.id))
  );
}

export interface FoundSurvey {
  survey: SandboxSurvey;
  membership: SandboxMembership | null;
}

/** The survey, 404 when unknown or invisible to the user (they look the same). */
export function visibleSurvey(data: SandboxData, user: SandboxUser, id: string): FoundSurvey {
  checkPathId(id, "surveyId");
  const survey = data.surveys.find((candidate) => sameId(candidate.id, id));
  if (!survey) throw notFound();
  const membership = surveyMembership(data, user, survey);
  if (!canSee(survey, user, membership)) throw notFound();
  return { survey, membership };
}

/** `visibleSurvey`, and the user may modify it (403 otherwise). */
export function modifiableSurvey(data: SandboxData, user: SandboxUser, id: string): FoundSurvey {
  const found = visibleSurvey(data, user, id);
  if (!canModify(found.survey, user, found.membership)) {
    throw forbidden("You cannot modify this survey.");
  }
  return found;
}

// ---------------------------------------------------------------- scopes (service.ts)

/** The scope a request names: its owner, the user's membership and the cursor key. */
export interface Scope {
  owner: SandboxSurvey["owner"];
  membership: SandboxMembership | null;
  key: string;
}

export const personalScope = (user: SandboxUser): Scope => ({
  owner: { kind: "personal", userId: user.id },
  membership: null,
  key: PERSONAL,
});

export const projectScope = (membership: SandboxMembership): Scope => ({
  owner: { kind: "project", projectId: lower(membership.projectId) },
  membership,
  key: lower(membership.projectId),
});

const notMember = () => forbidden("You are not a member of this project.");

/** The scope a `projectId` names: null is Personal; a project needs membership (403). */
export function targetScope(data: SandboxData, user: SandboxUser, projectId: string | null): Scope {
  if (projectId === null) return personalScope(user);
  const membership = membershipOf(data, user.id, projectId);
  if (!membership) throw notMember();
  return projectScope(membership);
}

export const sameOwner = (a: SandboxSurvey["owner"], b: SandboxSurvey["owner"]): boolean =>
  a.kind === "personal"
    ? b.kind === "personal" && sameId(a.userId, b.userId)
    : b.kind === "project" && sameId(a.projectId, b.projectId);
