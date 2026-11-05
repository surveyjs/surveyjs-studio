// Mirrors the survey operations of the server: server/src/surveys/service.ts (the rules),
// access.ts (404 then 403), permissions.ts (who may see and modify), patch.ts and
// domain/survey-changes.ts (merge-patch and a new record), json.ts (the Survey JSON) and
// providers/ordering.ts (the list order). The sandbox code does not import server/src.
import { HttpResponse } from "msw";
import type { SandboxMembership, SandboxSurvey, SandboxUser } from "../seed-types";
import type { SandboxData, SandboxFile } from "../store";
import {
  checkName,
  checkProjectId,
  compare,
  failOn,
  isRecord,
  lower,
  mutate,
  parseLimit,
  readJson,
  requireSession,
  requiredObject,
  sameId,
  view,
} from "./common";
import { newFileId, type HandlerContext } from "./context";
import { http } from "./http";
import { cloneName, MAX_NAME_UNITS, nextNewSurveyName } from "./naming";
import {
  decodeSurveyCursor,
  encodeSurveyCursor,
  type SurveyList,
  type SurveyPosition,
} from "./paging";
import {
  badRequest,
  forbidden,
  guarded,
  notFound,
  ProblemError,
  validationFailed,
  type ProblemFieldError,
} from "./problems";

const PERSONAL = "personal";

// ---------------------------------------------------------------- access (permissions.ts, access.ts)

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
function surveyMembership(
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

// ---------------------------------------------------------------- shapes (json.ts)

/** The contract `Survey` of a record; the private-question list only when `privateQuestions` is given. */
export function surveyJson(
  survey: SandboxSurvey,
  canModifySurvey: boolean,
  privateQuestions?: readonly string[],
) {
  return {
    id: survey.id,
    name: survey.name,
    projectId: survey.owner.kind === "project" ? survey.owner.projectId : null,
    published: survey.published,
    archived: survey.archived,
    createdAt: survey.createdAt,
    updatedAt: survey.updatedAt,
    postId: survey.postId,
    resultId: survey.resultId,
    permissions: { canModify: canModifySurvey },
    settings: {
      publicResults: survey.settings.publicResults,
      storeRespondentIp: survey.settings.storeRespondentIp,
      ...(privateQuestions && { privateResultQuestions: [...privateQuestions] }),
    },
  };
}

/** A new record with the legacy defaults: published, active, no settings (survey-changes.ts). */
function newSurvey(
  fields: Pick<SandboxSurvey, "id" | "name" | "owner" | "creatorId" | "postId" | "resultId"> & {
    now: string;
  },
): SandboxSurvey {
  const { now, ...rest } = fields;
  return {
    ...rest,
    published: true,
    archived: false,
    createdAt: now,
    updatedAt: now,
    settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
  };
}

/** Removes everything that belongs to a survey (ADR 0010: children first; here, one write). */
export function dropSurvey(data: SandboxData, surveyId: string): void {
  const id = lower(surveyId);
  data.surveys = data.surveys.filter((survey) => survey.id !== id);
  for (const map of [
    data.definitions,
    data.themes,
    data.history,
    data.responses,
    data.completions,
    data.legacyViews,
    data.privateResultQuestions,
    data.idempotencyKeys,
  ] as Record<string, unknown>[]) {
    delete map[id];
  }
  for (const views of Object.values(data.savedViews)) delete views[id];
  data.files = data.files.filter((file) => file.surveyId !== id);
}

// ---------------------------------------------------------------- validation

function checkSettings(value: unknown, errors: ProblemFieldError[]): void {
  if (!isRecord(value)) {
    errors.push({ pointer: "/settings", detail: "must be object" });
    return;
  }
  for (const key of ["publicResults", "storeRespondentIp"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      errors.push({ pointer: `/settings/${key}`, detail: "must be boolean" });
    }
  }
  const names = value["privateResultQuestions"];
  if (names === undefined) return;
  const pointer = "/settings/privateResultQuestions";
  if (!Array.isArray(names)) {
    errors.push({ pointer, detail: "must be array" });
  } else if (names.length > 1000) {
    errors.push({ pointer, detail: "must NOT have more than 1000 items" });
  } else {
    names.forEach((name: unknown, index) => {
      if (typeof name !== "string" || name.length === 0 || [...name].length > 256) {
        errors.push({
          pointer: `${pointer}/${index}`,
          detail: "must be a string of 1 to 256 characters",
        });
      }
    });
    if (new Set(names).size !== names.length) {
      errors.push({ pointer, detail: "must NOT have duplicate items" });
    }
  }
}

/** What the contract schema cannot check about a name: blank, or too long in UTF-16 units. */
function nameProblem(name: unknown): ProblemError | null {
  if (typeof name !== "string") return null;
  const detail =
    name.trim() === ""
      ? "must not be blank"
      : name.length > MAX_NAME_UNITS
        ? `must NOT be longer than ${MAX_NAME_UNITS} UTF-16 code units`
        : null;
  return detail === null ? null : validationFailed([{ pointer: "/name", detail }]);
}

interface SurveyListQuery {
  project: string;
  archived: boolean;
  limit: number;
  cursor: string | undefined;
}

function parseListQuery(url: URL): SurveyListQuery {
  const errors: ProblemFieldError[] = [];
  const params = url.searchParams;
  const archivedText = params.get("archived");
  if (archivedText !== null && archivedText !== "true" && archivedText !== "false") {
    errors.push({ pointer: "/archived", detail: "must be boolean" });
  }
  const limit = parseLimit(params, errors);
  if (errors.length > 0) throw badRequest(undefined, errors);
  return {
    project: params.get("project") ?? PERSONAL,
    archived: archivedText === "true",
    limit,
    cursor: params.get("cursor") ?? undefined,
  };
}

// ---------------------------------------------------------------- ordering (ordering.ts)

/** updatedAt descending, then id ascending. */
const surveyListOrder = (a: SandboxSurvey, b: SandboxSurvey): number =>
  compare(b.updatedAt, a.updatedAt) || compare(a.id, b.id);

/** After the position in `surveyListOrder`: updated earlier, or at the same instant with a greater id. */
function isAfter(survey: SandboxSurvey, position: SurveyPosition): boolean {
  const updated = Date.parse(survey.updatedAt);
  const at = Date.parse(position.updatedAt);
  return updated < at || (updated === at && survey.id > position.id);
}

// ---------------------------------------------------------------- service

/** The scope a request names: its owner, the user's membership and the cursor key. */
interface Scope {
  owner: SandboxSurvey["owner"];
  membership: SandboxMembership | null;
  key: string;
}

const personalScope = (user: SandboxUser): Scope => ({
  owner: { kind: "personal", userId: user.id },
  membership: null,
  key: PERSONAL,
});

const projectScope = (membership: SandboxMembership): Scope => ({
  owner: { kind: "project", projectId: lower(membership.projectId) },
  membership,
  key: lower(membership.projectId),
});

const notMember = () => forbidden("You are not a member of this project.");

/** The scope a `projectId` names: null is Personal; a project needs membership (403). */
function targetScope(data: SandboxData, user: SandboxUser, projectId: string | null): Scope {
  if (projectId === null) return personalScope(user);
  const membership = membershipOf(data, user.id, projectId);
  if (!membership) throw notMember();
  return projectScope(membership);
}

const sameOwner = (a: SandboxSurvey["owner"], b: SandboxSurvey["owner"]): boolean =>
  a.kind === "personal"
    ? b.kind === "personal" && sameId(a.userId, b.userId)
    : b.kind === "project" && sameId(a.projectId, b.projectId);

const privateQuestionsOf = (data: SandboxData, surveyId: string): string[] => [
  ...(data.privateResultQuestions[surveyId] ?? []),
];

/** The ids of the files in a text, replaced by their copies' ids (files/rewrite.ts). */
function rewriteFileIds(text: string, ids: ReadonlyMap<string, string>): string {
  let result = text;
  for (const [oldId, newId] of ids) result = result.replaceAll(oldId, newId);
  return result;
}

export function surveyHandlers(ctx: HandlerContext) {
  const createdSurvey = (
    data: SandboxData,
    user: SandboxUser,
    scope: Scope,
    name: string,
    now: string,
  ) => {
    const survey = newSurvey({
      id: ctx.newId(),
      name,
      owner: scope.owner,
      creatorId: lower(user.id),
      postId: ctx.newId(),
      resultId: ctx.newId(),
      now,
    });
    data.surveys.push(survey);
    return survey;
  };

  return [
    http.get("/surveys", ({ request, cookies }) =>
      guarded(() => {
        requireSession(ctx, cookies);
        const { project, archived, limit, cursor } = parseListQuery(new URL(request.url));
        return view(ctx, cookies, (data, user) => {
          let scope = personalScope(user);
          if (project !== PERSONAL) {
            // An unknown id, text that is no id and a project of others all look the same.
            const membership = membershipOf(data, user.id, project);
            if (!membership) throw notFound();
            scope = projectScope(membership);
          }
          const list: SurveyList = { scope: scope.key, archived };
          const after = cursor === undefined ? undefined : decodeSurveyCursor(cursor, list);
          const matching = data.surveys
            .filter((s) => sameOwner(s.owner, scope.owner) && s.archived === archived)
            .filter((s) => after === undefined || isAfter(s, after))
            .sort(surveyListOrder);
          const items = matching.slice(0, limit);
          const last = items.at(-1);
          return HttpResponse.json({
            items: items.map((s) => surveyJson(s, canModify(s, user, scope.membership))),
            nextCursor:
              matching.length > items.length && last
                ? encodeSurveyCursor({ updatedAt: last.updatedAt, id: last.id }, list)
                : null,
          });
        });
      }),
    ),

    http.post("/surveys", ({ request, cookies }) =>
      guarded(async () => {
        requireSession(ctx, cookies);
        const raw = await readJson(request);
        const body = raw === undefined ? {} : requiredObject(raw);
        const errors: ProblemFieldError[] = [];
        if (body["name"] !== undefined) checkName(body["name"], errors);
        if (body["projectId"] !== undefined) checkProjectId(body["projectId"], errors);
        const definition = body["definition"];
        if (definition !== undefined && !isRecord(definition)) {
          errors.push({ pointer: "/definition", detail: "must be object" });
        }
        failOn(errors);
        const invalid = nameProblem(body["name"]);
        if (invalid) throw invalid;
        const name = body["name"] as string | undefined;
        const projectId = body["projectId"] as string | null | undefined;
        const created = mutate(ctx, cookies, (data, user) => {
          const scope =
            projectId === undefined || projectId === null
              ? personalScope(user)
              : targetScope(data, user, projectId);
          // As on surveyjs.io, the default name counts only the active surveys of the scope.
          const surveyName =
            name ??
            nextNewSurveyName(
              data.surveys
                .filter((s) => sameOwner(s.owner, scope.owner) && !s.archived)
                .map((s) => s.name),
            );
          const now = ctx.now().toISOString();
          const survey = createdSurvey(data, user, scope, surveyName, now);
          if (definition !== undefined) {
            data.definitions[survey.id] = structuredClone(definition as Record<string, unknown>);
            data.history[survey.id] = [
              {
                id: ctx.newId(),
                at: now,
                userId: lower(user.id),
                snapshot: structuredClone(definition as Record<string, unknown>),
              },
            ];
          }
          return surveyJson(survey, canModify(survey, user, scope.membership), []);
        });
        return HttpResponse.json(created, {
          status: 201,
          headers: { Location: `/api/v1/surveys/${created.id}` },
        });
      }),
    ),

    http.get("/surveys/{surveyId}", ({ params, cookies }) =>
      guarded(() =>
        view(ctx, cookies, (data, user) => {
          const { survey, membership } = visibleSurvey(data, user, params.surveyId);
          return HttpResponse.json(
            surveyJson(
              survey,
              canModify(survey, user, membership),
              privateQuestionsOf(data, survey.id),
            ),
          );
        }),
      ),
    ),

    http.patch("/surveys/{surveyId}", ({ params, request, cookies }) =>
      guarded(async () => {
        requireSession(ctx, cookies);
        const raw = await readJson(request, ["application/merge-patch+json", "application/json"]);
        const patch = requiredObject(raw);
        const errors: ProblemFieldError[] = [];
        if (Object.keys(patch).length === 0) {
          errors.push({ pointer: "", detail: "must NOT have fewer than 1 properties" });
        }
        if (patch["name"] !== undefined) checkName(patch["name"], errors);
        if (patch["projectId"] !== undefined) checkProjectId(patch["projectId"], errors);
        for (const key of ["archived", "published"]) {
          if (patch[key] !== undefined && typeof patch[key] !== "boolean") {
            errors.push({ pointer: `/${key}`, detail: "must be boolean" });
          }
        }
        if (patch["settings"] !== undefined) checkSettings(patch["settings"], errors);
        failOn(errors);
        const invalid = nameProblem(patch["name"]);
        if (invalid) throw invalid;
        const settings = patch["settings"] as
          | {
              publicResults?: boolean;
              storeRespondentIp?: boolean;
              privateResultQuestions?: string[];
            }
          | undefined;

        const updated = mutate(ctx, cookies, (data, user) => {
          const { survey } = modifiableSurvey(data, user, params.surveyId);
          const target =
            patch["projectId"] === undefined
              ? undefined
              : targetScope(data, user, patch["projectId"] as string | null).owner;
          // Merge-patch (patch.ts, survey-changes.ts): known members only; updatedAt always moves.
          if (typeof patch["name"] === "string") survey.name = patch["name"];
          if (target !== undefined && !sameOwner(target, survey.owner)) {
            survey.owner =
              target.kind === "personal"
                ? { kind: "personal", userId: lower(target.userId) }
                : { kind: "project", projectId: lower(target.projectId) };
            survey.creatorId = lower(user.id);
          }
          if (typeof patch["published"] === "boolean") survey.published = patch["published"];
          if (typeof patch["archived"] === "boolean") survey.archived = patch["archived"];
          if (settings?.publicResults !== undefined) {
            survey.settings.publicResults = settings.publicResults;
          }
          if (settings?.storeRespondentIp !== undefined) {
            survey.settings.storeRespondentIp = settings.storeRespondentIp;
          }
          survey.updatedAt = ctx.now().toISOString();
          if (settings?.privateResultQuestions !== undefined) {
            data.privateResultQuestions[survey.id] = [...settings.privateResultQuestions];
          }
          // The rights follow the stored scope: a move changes the scope and the creator.
          const membership = surveyMembership(data, user, survey);
          return surveyJson(
            survey,
            canModify(survey, user, membership),
            privateQuestionsOf(data, survey.id),
          );
        });
        return HttpResponse.json(updated);
      }),
    ),

    http.delete("/surveys/{surveyId}", ({ params, cookies }) =>
      guarded(() => {
        mutate(ctx, cookies, (data, user) => {
          const { survey } = modifiableSurvey(data, user, params.surveyId);
          if (!survey.archived) {
            throw new ProblemError({
              code: "survey-not-archived",
              status: 409,
              title: "Archive the survey before deleting it",
            });
          }
          dropSurvey(data, survey.id);
        });
        return new HttpResponse(null, { status: 204 });
      }),
    ),

    http.post("/surveys/{surveyId}/clones", ({ params, request, cookies }) =>
      guarded(async () => {
        requireSession(ctx, cookies);
        const raw = await readJson(request);
        const body = raw === undefined ? {} : requiredObject(raw);
        const errors: ProblemFieldError[] = [];
        if (body["name"] !== undefined) checkName(body["name"], errors);
        if (body["projectId"] !== undefined) checkProjectId(body["projectId"], errors);
        failOn(errors);
        const invalid = nameProblem(body["name"]);
        if (invalid) throw invalid;
        const name = body["name"] as string | undefined;
        const projectId = body["projectId"] as string | null | undefined;

        const copy = mutate(ctx, cookies, (data, user) => {
          const { survey: source, membership } = visibleSurvey(data, user, params.surveyId);
          // Without `projectId` the copy stays in the source's scope.
          const scope =
            projectId !== undefined
              ? targetScope(data, user, projectId)
              : membership
                ? projectScope(membership)
                : personalScope(user);
          const now = ctx.now().toISOString();
          const copyId = ctx.newId();
          // The editor's files are copied under ids of the copy; respondents' files are not (R10).
          const ids = new Map<string, string>();
          const copiedFiles: SandboxFile[] = [];
          for (const file of data.files) {
            if (file.surveyId !== source.id || file.kind === "respondent") continue;
            const id = newFileId(copyId);
            ids.set(file.id, id);
            copiedFiles.push({ ...file, id, surveyId: copyId, createdAt: now });
          }
          data.files.push(...copiedFiles);
          const rewritten = (document: Record<string, unknown> | undefined) =>
            document === undefined
              ? undefined
              : ids.size === 0
                ? structuredClone(document)
                : (JSON.parse(rewriteFileIds(JSON.stringify(document), ids)) as Record<
                    string,
                    unknown
                  >);
          const stored = newSurvey({
            id: copyId,
            name: name ?? cloneName(source.name),
            owner: scope.owner,
            creatorId: lower(user.id),
            postId: ctx.newId(),
            resultId: ctx.newId(),
            now,
          });
          data.surveys.push(stored);
          const definition = rewritten(data.definitions[source.id]);
          if (definition !== undefined) {
            data.definitions[copyId] = definition;
            data.history[copyId] = [
              {
                id: ctx.newId(),
                at: now,
                userId: lower(user.id),
                snapshot: structuredClone(definition),
              },
            ];
          }
          const theme = rewritten(data.themes[source.id]);
          if (theme !== undefined) data.themes[copyId] = theme;
          return surveyJson(stored, canModify(stored, user, scope.membership), []);
        });
        return HttpResponse.json(copy, {
          status: 201,
          headers: { Location: `/api/v1/surveys/${copy.id}` },
        });
      }),
    ),
  ];
}
