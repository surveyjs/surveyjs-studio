// Mirrors the survey operations of the server: server/src/surveys/service.ts (the rules), patch.ts
// and domain/survey-changes.ts (merge-patch) and providers/ordering.ts (the list order). Who may see
// and modify a survey is in survey-access.ts, the records in survey-records.ts and the input checks
// in survey-input.ts. The sandbox code does not import server/src.
import { HttpResponse } from "msw";
import type { SandboxSurvey, SandboxUser } from "../seed-types";
import type { SandboxData, SandboxFile } from "../store";
import {
  checkName,
  checkProjectId,
  compare,
  failOn,
  lower,
  mutate,
  readJson,
  requireSession,
  requiredObject,
  view,
} from "./common";
import { newFileId, type HandlerContext } from "./context";
import { http } from "./http";
import { cloneName, nextNewSurveyName } from "./naming";
import { addHistoryEntry } from "./history";
import {
  decodeSurveyCursor,
  encodeSurveyCursor,
  type SurveyList,
  type SurveyPosition,
} from "./paging";
import { guarded, notFound, ProblemError, type ProblemFieldError } from "./problems";
import {
  canModify,
  membershipOf,
  modifiableSurvey,
  PERSONAL,
  personalScope,
  projectScope,
  sameOwner,
  surveyMembership,
  targetScope,
  visibleSurvey,
  type Scope,
} from "./survey-access";
import { checkSettings, nameProblem, newSurveyFields, parseListQuery } from "./survey-input";
import {
  dropSurvey,
  newSurvey,
  privateQuestionsOf,
  rewriteFileIds,
  surveyJson,
} from "./survey-records";

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

// ---------------------------------------------------------------- handlers

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
        const { name, projectId, definition } = newSurveyFields(await readJson(request), true);
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
            const stored = structuredClone(definition);
            data.definitions[survey.id] = stored;
            addHistoryEntry(
              data,
              survey.id,
              { id: ctx.newId(), at: now, userId: lower(user.id) },
              stored,
            );
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
        const { name, projectId } = newSurveyFields(await readJson(request), false);

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
            addHistoryEntry(
              data,
              copyId,
              { id: ctx.newId(), at: now, userId: lower(user.id) },
              definition,
            );
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
