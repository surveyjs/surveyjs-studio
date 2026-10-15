import type { ProjectMembership, SurveyRecord } from "../domain/types.js";

/**
 * Who may see and change a survey (the legacy `MySurveyInfo.CanModifySurvey` rule, ADR 0009):
 *
 * | Question   | Personal survey | Project survey                       |
 * | ---------- | --------------- | ------------------------------------ |
 * | See        | its owner       | any member of the project            |
 * | Modify     | its owner       | a project admin, or its creator      |
 *
 * `membership` is the user's membership of the survey's project, or null (personal survey, or
 * not a member).
 */

interface Viewer {
  readonly id: string;
}

/** Ids are GUIDs, matched case-insensitively. */
const sameId = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

function memberOf(survey: SurveyRecord, membership: ProjectMembership | null): boolean {
  return (
    survey.owner.kind === "project" &&
    membership !== null &&
    sameId(membership.project.id, survey.owner.projectId)
  );
}

export function canSee(
  survey: SurveyRecord,
  user: Viewer,
  membership: ProjectMembership | null,
): boolean {
  return survey.owner.kind === "personal"
    ? sameId(survey.owner.userId, user.id)
    : memberOf(survey, membership);
}

export function canModify(
  survey: SurveyRecord,
  user: Viewer,
  membership: ProjectMembership | null,
): boolean {
  if (survey.owner.kind === "personal") return sameId(survey.owner.userId, user.id);
  if (!memberOf(survey, membership)) return false;
  return (
    membership?.role === "admin" || (survey.creatorId !== null && sameId(survey.creatorId, user.id))
  );
}
