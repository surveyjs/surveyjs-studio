import { randomUUID } from "node:crypto";
import type { components } from "@my-surveys/contract";
import type { RequestUser } from "../auth/authenticate.js";
import type { Clock } from "../auth/session.js";
import type { ProjectMembership, SurveyOwner } from "../domain/types.js";
import { AppError } from "../errors.js";
import { decodeSurveyCursor, encodeSurveyCursor, type SurveyList } from "../paging/cursor.js";
import type { Directory, SurveyStore } from "../providers/types.js";
import { surveyJson, type SurveyJson } from "./json.js";
import { nextNewSurveyName } from "./naming.js";
import { canModify, canSee } from "./permissions.js";

type SurveyCreate = components["schemas"]["SurveyCreate"];
type SurveyPage = components["schemas"]["SurveyPage"];

export interface SurveysServiceOptions {
  readonly surveys: SurveyStore;
  readonly directory: Directory;
  /** The clock for creation times; default `Date.now`. */
  readonly now?: Clock;
}

/** The `listSurveys` query, after contract validation and defaults. */
export interface SurveyListQuery {
  /** `personal`, or a project id. */
  readonly project: string;
  readonly archived: boolean;
  readonly limit: number;
  readonly cursor?: string;
}

export interface SurveysService {
  list(user: RequestUser, query: SurveyListQuery): Promise<SurveyPage>;
  create(user: RequestUser, body: SurveyCreate | undefined): Promise<SurveyJson>;
  get(user: RequestUser, surveyId: string): Promise<SurveyJson>;
}

const PERSONAL = "personal";

/** Legacy `Surveys.name` is nvarchar(200): 200 UTF-16 code units. */
const MAX_NAME_UNITS = 200;

/**
 * What the contract schema cannot check about a given name, or null. The schema's `maxLength`
 * counts characters (code points), so a name with characters outside the BMP can pass it and still
 * not fit the legacy column.
 */
function invalidName(name: string): string | null {
  if (name.trim() === "") return "must not be blank";
  if (name.length > MAX_NAME_UNITS) {
    return `must NOT be longer than ${MAX_NAME_UNITS} UTF-16 code units`;
  }
  return null;
}

function notFound(): AppError {
  return new AppError({ code: "not-found", status: 404, title: "Not found" });
}

/** A survey scope the user may list and create in. */
interface Scope {
  readonly owner: SurveyOwner;
  /** The user's membership of the scope's project; null for the personal scope. */
  readonly membership: ProjectMembership | null;
  /** `personal`, or the lower-case project id (as cursors name it). */
  readonly key: string;
}

const personalScope = (user: RequestUser): Scope => ({
  owner: { kind: "personal", userId: user.id },
  membership: null,
  key: PERSONAL,
});

const projectScope = (membership: ProjectMembership): Scope => ({
  owner: { kind: "project", projectId: membership.project.id },
  membership,
  key: membership.project.id.toLowerCase(),
});

/** `listSurveys`, `createSurvey` and `getSurvey`: the rules of the survey records. */
export function createSurveysService(options: SurveysServiceOptions): SurveysService {
  const { surveys, directory, now = Date.now } = options;

  return {
    async list(user, { project, archived, limit, cursor }) {
      let scope = personalScope(user);
      if (project !== PERSONAL) {
        // An unknown id, text that is no id and a project of others all look the same.
        const membership = await directory.getUserProject(user.id, project);
        if (!membership) throw notFound();
        scope = projectScope(membership);
      }
      const list: SurveyList = { scope: scope.key, archived };
      const page = await surveys.listSurveyPage({
        owner: scope.owner,
        archived,
        limit,
        ...(cursor !== undefined && { after: decodeSurveyCursor(cursor, list) }),
      });
      return {
        items: page.items.map((survey) =>
          surveyJson(survey, canModify(survey, user, scope.membership)),
        ),
        nextCursor: page.next ? encodeSurveyCursor(page.next, list) : null,
      };
    },

    async create(user, body = {}) {
      const { name, projectId, definition } = body;
      const nameProblem = name === undefined ? null : invalidName(name);
      if (nameProblem !== null) {
        throw new AppError({
          code: "validation-failed",
          status: 422,
          title: "Validation failed",
          errors: [{ pointer: "/name", detail: nameProblem }],
        });
      }
      let scope = personalScope(user);
      if (projectId !== undefined && projectId !== null) {
        const membership = await directory.getUserProject(user.id, projectId);
        if (!membership) {
          throw new AppError({
            code: "forbidden",
            status: 403,
            title: "Forbidden",
            detail: "You are not a member of this project.",
          });
        }
        scope = projectScope(membership);
      }
      // As on surveyjs.io, the default name counts only the active surveys of the scope.
      const surveyName =
        name ??
        nextNewSurveyName(
          (await surveys.listSurveys(scope.owner)).filter((s) => !s.archived).map((s) => s.name),
        );
      const createdAt = new Date(now()).toISOString();
      const stored = await surveys.createSurvey(
        {
          id: randomUUID(),
          name: surveyName,
          owner: scope.owner,
          creatorId: user.id,
          postId: randomUUID(),
          resultId: randomUUID(),
          createdAt,
          updatedAt: createdAt,
        },
        definition,
      );
      return surveyJson(stored, canModify(stored, user, scope.membership));
    },

    async get(user, surveyId) {
      const survey = await surveys.getSurvey(surveyId);
      if (!survey) throw notFound();
      const membership =
        survey.owner.kind === "project"
          ? await directory.getUserProject(user.id, survey.owner.projectId)
          : null;
      // A survey the user cannot see answers like an unknown one.
      if (!canSee(survey, user, membership)) throw notFound();
      return surveyJson(survey, canModify(survey, user, membership));
    },
  };
}
