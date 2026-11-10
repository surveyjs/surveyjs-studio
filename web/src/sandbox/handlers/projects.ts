// Mirrors server/src/projects/ (handlers.ts, service.ts: list, create, get, rename, delete) over
// the sandbox document. The sandbox has no instance admin (D6: `/me` has no `instanceRole`), so
// `scope=all` is always `403`. The sandbox code does not import server/src.
import { HttpResponse } from "msw";
import type { SandboxMembership, SandboxProject, SandboxUser } from "../seed-types";
import type { SandboxData } from "../store";
import {
  checkPathId,
  failOn,
  lower,
  mutate,
  parsePagingQuery,
  readJson,
  requireSession,
  requiredObject,
  sameId,
  view,
} from "./common";
import type { HandlerContext } from "./context";
import { http } from "./http";
import { membershipOf } from "./survey-access";
import { decodeProjectCursor, encodeProjectCursor, type NamePosition } from "./paging";
import { ownerOf, projectJson, projectOrder, rowsOf, surveyReceiver } from "./project-rules";
import {
  badRequest,
  forbidden,
  guarded,
  notFound,
  validationFailed,
  type ProblemFieldError,
} from "./problems";

/** The path's project id is an `Id` of 1 to 64 characters (the contract's schema): 400 otherwise. */
export function checkProjectPath(projectId: string): void {
  checkPathId(projectId, "projectId");
}

export interface Access {
  project: SandboxProject;
  membership: SandboxMembership;
}

/** The caller's project and membership; a project of others answers like an unknown one (service.ts `access`). */
export function accessProject(data: SandboxData, user: SandboxUser, projectId: string): Access {
  const membership = membershipOf(data, user.id, projectId);
  const project = membership ? data.projects.find((p) => sameId(p.id, projectId)) : undefined;
  if (!membership || !project) throw notFound();
  return { project, membership };
}

/** `accessProject`, and the caller is an admin of it (`403 forbidden` otherwise). */
export function adminAccess(data: SandboxData, user: SandboxUser, projectId: string): Access {
  const access = accessProject(data, user, projectId);
  if (access.membership.role !== "admin") throw forbidden("Only project admins can do this.");
  return access;
}

/** A name is 1 to 128 characters and not blank (contract ProjectName; service.ts `checkName`, R14). */
function checkName(name: unknown, errors: ProblemFieldError[]): void {
  if (typeof name !== "string") {
    errors.push({ pointer: "/name", detail: "must be string" });
  } else if (name.length === 0) {
    errors.push({ pointer: "/name", detail: "must NOT have fewer than 1 characters" });
  } else if ([...name].length > 128) {
    errors.push({ pointer: "/name", detail: "must NOT have more than 128 characters" });
  } else if (name.trim() === "") {
    errors.push({ pointer: "/name", detail: "must not be blank" });
  }
}

/** Whether `position` comes strictly after `after` in (name, id) order (service.ts `isAfter`). */
const isAfter = (position: NamePosition, after: NamePosition): boolean =>
  position.name > after.name || (position.name === after.name && position.id > after.id);

export function projectHandlers(ctx: HandlerContext) {
  return [
    http.get("/projects", ({ request, cookies }) =>
      guarded(() => {
        requireSession(ctx, cookies);
        const url = new URL(request.url);
        const scope = url.searchParams.get("scope");
        if (scope !== null && scope !== "member" && scope !== "all") {
          throw badRequest(undefined, [
            { pointer: "/scope", detail: "must be equal to one of the allowed values" },
          ]);
        }
        const { limit, cursor } = parsePagingQuery(url);
        if (scope === "all") throw forbidden("Only instance admins can list every project.");
        const after = cursor === undefined ? undefined : decodeProjectCursor(cursor);
        return view(ctx, cookies, (data, user) => {
          const all = data.memberships
            .filter((m) => sameId(m.userId, user.id))
            .flatMap((m) => {
              const project = data.projects.find((p) => sameId(p.id, m.projectId));
              return project ? [{ project, role: m.role }] : [];
            })
            .sort((a, b) => projectOrder(a.project, b.project));
          const position = ({ project }: { project: SandboxProject }): NamePosition => ({
            name: project.name.toLowerCase(),
            id: project.id,
          });
          const rest = after ? all.filter((entry) => isAfter(position(entry), after)) : all;
          const items = rest.slice(0, limit);
          const last = items.at(-1);
          return HttpResponse.json({
            items: items.map(({ project, role }) => projectJson(data, project, role)),
            nextCursor:
              last !== undefined && rest.length > limit
                ? encodeProjectCursor(position(last))
                : null,
          });
        });
      }),
    ),

    http.post("/projects", ({ request, cookies }) =>
      guarded(async () => {
        requireSession(ctx, cookies);
        const raw = await readJson(request);
        if (raw === undefined)
          throw validationFailed([{ pointer: "", detail: "Request body is required" }]);
        const body = requiredObject(raw);
        const errors: ProblemFieldError[] = [];
        if (body["name"] === undefined) {
          errors.push({ pointer: "", detail: "must have required property 'name'" });
        } else {
          checkName(body["name"], errors);
        }
        failOn(errors);
        const created = mutate(ctx, cookies, (data, user) => {
          const project: SandboxProject = {
            id: lower(ctx.newId()),
            name: body["name"] as string,
            creatorId: lower(user.id),
            createdAt: ctx.now().toISOString(),
          };
          data.projects.push(project);
          data.memberships.push({ userId: lower(user.id), projectId: project.id, role: "admin" });
          return projectJson(data, project, "admin");
        });
        return HttpResponse.json(created, {
          status: 201,
          headers: { Location: `/api/v1/projects/${created.id}` },
        });
      }),
    ),

    http.get("/projects/{projectId}", ({ params, cookies }) =>
      guarded(() => {
        requireSession(ctx, cookies);
        checkProjectPath(params.projectId);
        return view(ctx, cookies, (data, user) => {
          const { project, membership } = accessProject(data, user, params.projectId);
          return HttpResponse.json(projectJson(data, project, membership.role));
        });
      }),
    ),

    http.patch("/projects/{projectId}", ({ params, request, cookies }) =>
      guarded(async () => {
        requireSession(ctx, cookies);
        checkProjectPath(params.projectId);
        const patch = requiredObject(
          await readJson(request, ["application/merge-patch+json", "application/json"]),
        );
        const errors: ProblemFieldError[] = [];
        if (Object.keys(patch).length === 0) {
          errors.push({ pointer: "", detail: "must NOT have fewer than 1 properties" });
        }
        if (patch["name"] !== undefined) checkName(patch["name"], errors);
        failOn(errors);
        const renamed = mutate(ctx, cookies, (data, user) => {
          const { project } = adminAccess(data, user, params.projectId);
          // A patch without a name (only unknown members) changes nothing.
          if (typeof patch["name"] === "string") project.name = patch["name"];
          return projectJson(data, project, "admin");
        });
        return HttpResponse.json(renamed);
      }),
    ),

    http.delete("/projects/{projectId}", ({ params, cookies }) =>
      guarded(() => {
        requireSession(ctx, cookies);
        checkProjectPath(params.projectId);
        mutate(ctx, cookies, (data, user) => {
          const { project } = adminAccess(data, user, params.projectId);
          const visible = rowsOf(data, project.id)
            .filter((row) => row.userExists)
            .map((row) => row.userId);
          const receiver = surveyReceiver(ownerOf(data, project), visible, user.id);
          // The surveys become the receiver's personal ones; the creator is kept (R9, R2).
          const now = ctx.now().toISOString();
          for (const survey of data.surveys) {
            if (survey.owner.kind !== "project" || !sameId(survey.owner.projectId, project.id)) {
              continue;
            }
            survey.owner = { kind: "personal", userId: receiver };
            survey.updatedAt = now;
          }
          data.memberships = data.memberships.filter((m) => !sameId(m.projectId, project.id));
          data.invitations = data.invitations.filter((i) => !sameId(i.projectId, project.id));
          data.projects = data.projects.filter((p) => !sameId(p.id, project.id));
        });
        return new HttpResponse(null, { status: 204 });
      }),
    ),
  ];
}
