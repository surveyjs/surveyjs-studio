import { type RequestUser } from "../auth/authenticate.js";
import { inScope, membershipIn } from "../credentials/scope.js";
import type { ProjectMembership, SurveyRecord } from "../domain/types.js";
import { AppError } from "../errors.js";
import type { ProjectStore, SurveyStore } from "../providers/types.js";
import { canModify, canSee } from "./permissions.js";

export function notFound(): AppError {
  return new AppError({ code: "not-found", status: 404, title: "Not found" });
}

/**
 * A survey and the membership the request acts with in its project (null for a personal survey):
 * the user's own, or a project token's admin membership.
 */
export interface FoundSurvey {
  readonly survey: SurveyRecord;
  readonly membership: ProjectMembership | null;
}

export interface SurveyAccess {
  /** The survey and the membership in its project; 404 when unknown, invisible or out of scope. */
  visible(user: RequestUser, surveyId: string): Promise<FoundSurvey>;
  /** `visible`, and the user may modify the survey (403 otherwise). */
  modifiable(user: RequestUser, surveyId: string): Promise<FoundSurvey>;
}

/**
 * The 404 and 403 checks every survey operation starts with (ADR 0009, ADR 0011). A survey outside
 * the credential's scope answers 404 as an unknown one; a project token acts as an admin of its
 * project (ADR 0037).
 */
export function createSurveyAccess(stores: {
  readonly surveys: SurveyStore;
  readonly projects: ProjectStore;
}): SurveyAccess {
  const { surveys, projects } = stores;
  const membershipOf = membershipIn(projects);

  async function visible(user: RequestUser, surveyId: string): Promise<FoundSurvey> {
    const survey = await surveys.getSurvey(surveyId);
    if (!survey || !inScope(user.scope, survey.owner)) throw notFound();
    const membership =
      survey.owner.kind === "project" ? await membershipOf(user, survey.owner.projectId) : null;
    // A survey the user cannot see answers like an unknown one.
    if (!canSee(survey, user, membership)) throw notFound();
    return { survey, membership };
  }

  async function modifiable(user: RequestUser, surveyId: string): Promise<FoundSurvey> {
    const found = await visible(user, surveyId);
    if (!canModify(found.survey, user, found.membership)) {
      throw new AppError({
        code: "forbidden",
        status: 403,
        title: "Forbidden",
        detail: "You cannot modify this survey.",
      });
    }
    return found;
  }

  return { visible, modifiable };
}
