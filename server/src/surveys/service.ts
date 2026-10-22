import { randomUUID } from "node:crypto";
import type { components } from "@my-surveys/contract";
import type { RequestUser } from "../auth/authenticate.js";
import type { Clock } from "../auth/session.js";
import type { ProjectMembership, SurveyOwner } from "../domain/types.js";
import { AppError } from "../errors.js";
import { decodeSurveyCursor, encodeSurveyCursor, type SurveyList } from "../paging/cursor.js";
import { rewriteFileIds } from "../files/rewrite.js";
import type { ProjectStore, FileStore, SurveyStore, ViewStore } from "../providers/types.js";
import { createSurveyAccess, notFound } from "./access.js";
import { surveyJson, type SurveyJson } from "./json.js";
import { cloneName, nextNewSurveyName } from "./naming.js";
import { surveyChangesFromPatch } from "./patch.js";
import { canModify } from "./permissions.js";

type SurveyCreate = components["schemas"]["SurveyCreate"];
type SurveyPage = components["schemas"]["SurveyPage"];
type SurveyPatch = components["schemas"]["SurveyPatch"];
/** The optional `cloneSurvey` body. */
type SurveyClone = { name?: string; projectId?: string | null };

export interface SurveysServiceOptions {
  readonly surveys: SurveyStore;
  readonly projects: ProjectStore;
  /** The files of surveys: deleted with a survey, copied with a clone (R10, R11). */
  readonly files: FileStore;
  /** The private-question lists. */
  readonly views: ViewStore;
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

/** Where a request's warnings go (the request's logger). */
export interface WarningLog {
  warn(details: Readonly<Record<string, string>>, message: string): void;
}

export interface SurveysService {
  list(user: RequestUser, query: SurveyListQuery): Promise<SurveyPage>;
  create(user: RequestUser, body: SurveyCreate | undefined): Promise<SurveyJson>;
  /** Answers without `settings.privateResultQuestions` when the list cannot be read (C1). */
  get(user: RequestUser, surveyId: string, log: WarningLog): Promise<SurveyJson>;
  /**
   * Saves the private-question list only after the survey update succeeded, so a failed update
   * leaves the old list. Answers the saved list, else the stored one as `get` does.
   */
  update(
    user: RequestUser,
    surveyId: string,
    patch: SurveyPatch,
    log: WarningLog,
  ): Promise<SurveyJson>;
  delete(user: RequestUser, surveyId: string): Promise<void>;
  clone(user: RequestUser, surveyId: string, body: SurveyClone | undefined): Promise<SurveyJson>;
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

/** A 422 for a name `invalidName` rejects, or null. */
function nameProblem(name: string | undefined): AppError | null {
  const detail = name === undefined ? null : invalidName(name);
  return detail === null
    ? null
    : new AppError({
        code: "validation-failed",
        status: 422,
        title: "Validation failed",
        errors: [{ pointer: "/name", detail }],
      });
}

const notMember = (): AppError =>
  new AppError({
    code: "forbidden",
    status: 403,
    title: "Forbidden",
    detail: "You are not a member of this project.",
  });

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

/** The rules of the survey records: list, create, get, update, delete and clone. */
export function createSurveysService(options: SurveysServiceOptions): SurveysService {
  const { surveys, projects, files, views, now = Date.now } = options;
  const { visible, modifiable } = createSurveyAccess({ surveys, projects });

  /**
   * The survey's private-question list for an answer; undefined (and a warning with the survey id
   * only) when the store cannot read it right now. The answer then leaves the field out (C1), so the
   * Summary cannot save a list built from an unknown state.
   */
  async function privateQuestionsFor(
    surveyId: string,
    log: WarningLog,
  ): Promise<readonly string[] | undefined> {
    try {
      return await views.getPrivateQuestions(surveyId);
    } catch {
      log.warn({ surveyId }, "The private-question list cannot be read; answered without it.");
      return undefined;
    }
  }

  /** The scope a `projectId` names: null is the user's Personal scope; a project needs membership. */
  async function targetScope(user: RequestUser, projectId: string | null): Promise<Scope> {
    if (projectId === null) return personalScope(user);
    const membership = await projects.getUserProject(user.id, projectId);
    if (!membership) throw notMember();
    return projectScope(membership);
  }

  return {
    async list(user, { project, archived, limit, cursor }) {
      let scope = personalScope(user);
      if (project !== PERSONAL) {
        // An unknown id, text that is no id and a project of others all look the same.
        const membership = await projects.getUserProject(user.id, project);
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
      const invalid = nameProblem(name);
      if (invalid) throw invalid;
      let scope = personalScope(user);
      if (projectId !== undefined && projectId !== null) {
        const membership = await projects.getUserProject(user.id, projectId);
        if (!membership) throw notMember();
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
      return surveyJson(stored, canModify(stored, user, scope.membership), []);
    },

    async get(user, surveyId, log) {
      const { survey, membership } = await visible(user, surveyId);
      return surveyJson(
        survey,
        canModify(survey, user, membership),
        await privateQuestionsFor(survey.id, log),
      );
    },

    async update(user, surveyId, patch, log) {
      const invalid = nameProblem(patch.name);
      if (invalid) throw invalid;
      const { survey } = await modifiable(user, surveyId);
      const target =
        patch.projectId === undefined
          ? undefined
          : (await targetScope(user, patch.projectId)).owner;
      const names = patch.settings?.privateResultQuestions;
      const stored = await surveys.updateSurvey(
        survey.id,
        surveyChangesFromPatch(survey, patch, {
          userId: user.id,
          now: new Date(now()).toISOString(),
          ...(target !== undefined && { target }),
        }),
      );
      if (!stored) throw notFound();
      // After the update: a failed update leaves the old list.
      if (names !== undefined) await views.savePrivateQuestions(stored.id, names);
      // The rights follow the stored scope: a move changes the scope and the creator.
      const membership =
        stored.owner.kind === "project"
          ? await projects.getUserProject(user.id, stored.owner.projectId)
          : null;
      return surveyJson(
        stored,
        canModify(stored, user, membership),
        names ?? (await privateQuestionsFor(stored.id, log)),
      );
    },

    async delete(user, surveyId) {
      const { survey } = await modifiable(user, surveyId);
      if (!survey.archived) {
        throw new AppError({
          code: "survey-not-archived",
          status: 409,
          title: "Archive the survey before deleting it",
        });
      }
      // Children first (ADR 0010): a failure here leaves the survey intact, and a retry finishes.
      await files.deleteSurveyFiles(survey.id);
      if (!(await surveys.deleteSurvey(survey.id))) throw notFound();
    },

    async clone(user, surveyId, body = {}) {
      const { name, projectId } = body;
      const invalid = nameProblem(name);
      if (invalid) throw invalid;
      const { survey, membership } = await visible(user, surveyId);
      // Without `projectId` the copy stays in the source's scope.
      const scope =
        projectId !== undefined
          ? await targetScope(user, projectId)
          : membership
            ? projectScope(membership)
            : personalScope(user);
      const createdAt = new Date(now()).toISOString();
      const copyId = randomUUID();
      const discardCopiedFiles = (): Promise<unknown> =>
        files.deleteSurveyFiles(copyId).catch(() => undefined);
      let ids: ReadonlyMap<string, string>;
      try {
        ids = await files.copySurveyAssets(survey.id, copyId, createdAt);
      } catch (error) {
        // The copy may have been committed before the failure was reported.
        await discardCopiedFiles();
        throw error;
      }
      let stored;
      try {
        stored = await surveys.cloneSurvey(
          survey.id,
          {
            id: copyId,
            name: name ?? cloneName(survey.name),
            owner: scope.owner,
            creatorId: user.id,
            postId: randomUUID(),
            resultId: randomUUID(),
            createdAt,
            updatedAt: createdAt,
          },
          ids.size > 0 ? { rewriteText: (text) => rewriteFileIds(text, ids) } : undefined,
        );
      } catch (error) {
        await discardCopiedFiles();
        throw error;
      }
      if (!stored) {
        await discardCopiedFiles();
        throw notFound();
      }
      return surveyJson(stored, canModify(stored, user, scope.membership), []);
    },
  };
}
