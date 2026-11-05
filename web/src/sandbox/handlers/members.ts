// Mirrors server/src/projects/ (handlers.ts, service.ts: listMembers, addMember, changeRole,
// removeMember, removeInvitation) over the sandbox document. D6: the mock is a local directory, so
// an email that no seed user has becomes a pending member (an invitation), never `user-not-found`.
// The sandbox code does not import server/src.
import { HttpResponse } from "msw";
import type { SandboxUser } from "../seed-types";
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
import { decodeMembersCursor, encodeMembersCursor, type NamePosition } from "./paging";
import { accessProject, adminAccess, checkProjectPath } from "./projects";
import {
  decideRemoval,
  decideRoleChange,
  memberJson,
  pendingMemberJson,
  rowsOf,
} from "./project-rules";
import { guarded, notFound, ProblemError, type ProblemFieldError } from "./problems";

/** Pending members come after every active one, by email; their cursor position sorts after any name. */
const PENDING_NAME = String.fromCodePoint(0x10ffff);
const PENDING_ID = "00000000-0000-0000-0000-000000000000";

const alreadyInvited = () =>
  new ProblemError({
    code: "already-invited",
    status: 409,
    title: "Already invited",
    detail: "This email address already has an invitation to this project.",
  });

const alreadyMember = () =>
  new ProblemError({
    code: "already-member",
    status: 409,
    title: "Already a member",
    detail: "The user is already a member of this project.",
  });

const lastAdmin = () =>
  new ProblemError({
    code: "last-admin",
    status: 409,
    title: "Last admin",
    detail: "A project must keep at least one admin.",
  });

/** The `email` format of the contract (the fast email pattern of ajv-formats). */
const EMAIL =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

const ROLES = ["admin", "user"];

function checkRole(value: unknown, errors: ProblemFieldError[]): void {
  if (typeof value !== "string" || !ROLES.includes(value)) {
    errors.push({ pointer: "/role", detail: "must be equal to one of the allowed values" });
  }
}

function checkEmail(value: unknown, pointer: string, errors: ProblemFieldError[]): void {
  if (typeof value !== "string") errors.push({ pointer, detail: "must be string" });
  else if (!EMAIL.test(value)) errors.push({ pointer, detail: 'must match format "email"' });
}

const isAfter = (position: NamePosition, after: NamePosition): boolean =>
  position.name > after.name || (position.name === after.name && position.id > after.id);

interface Listed {
  json: ReturnType<typeof memberJson> | ReturnType<typeof pendingMemberJson>;
  position: NamePosition;
}

export function memberHandlers(ctx: HandlerContext) {
  return [
    http.get("/projects/{projectId}/members", ({ params, request, cookies }) =>
      guarded(() => {
        requireSession(ctx, cookies);
        checkProjectPath(params.projectId);
        const { limit, cursor } = parsePagingQuery(new URL(request.url));
        return view(ctx, cookies, (data, user) => {
          const { project } = accessProject(data, user, params.projectId);
          const after = cursor === undefined ? undefined : decodeMembersCursor(cursor, project.id);
          // Members by display name ignoring case, then id; an orphan row is not shown (R11).
          const members: Listed[] = data.memberships
            .filter((m) => sameId(m.projectId, project.id))
            .flatMap((m) => {
              const found = data.users.find((u) => sameId(u.id, m.userId));
              return found
                ? [
                    {
                      json: memberJson(data, m),
                      position: { name: found.displayName.toLowerCase(), id: found.id },
                    },
                  ]
                : [];
            })
            .sort(
              (a, b) =>
                (a.position.name < b.position.name
                  ? -1
                  : a.position.name > b.position.name
                    ? 1
                    : 0) ||
                (a.position.id < b.position.id ? -1 : a.position.id > b.position.id ? 1 : 0),
            );
          const pending: Listed[] = data.invitations
            .filter((i) => sameId(i.projectId, project.id))
            .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0))
            .map((i) => ({
              json: pendingMemberJson(i),
              position: { name: `${PENDING_NAME}${i.email}`, id: PENDING_ID },
            }));
          const all = [...members, ...pending];
          const rest = after ? all.filter((item) => isAfter(item.position, after)) : all;
          const items = rest.slice(0, limit);
          const last = items.at(-1);
          return HttpResponse.json({
            items: items.map((item) => item.json),
            nextCursor:
              last !== undefined && rest.length > limit
                ? encodeMembersCursor(last.position, project.id)
                : null,
          });
        });
      }),
    ),

    http.post("/projects/{projectId}/members", ({ params, request, cookies }) =>
      guarded(async () => {
        requireSession(ctx, cookies);
        checkProjectPath(params.projectId);
        const body = requiredObject(await readJson(request));
        const errors: ProblemFieldError[] = [];
        if (body["email"] === undefined) {
          errors.push({ pointer: "", detail: "must have required property 'email'" });
        } else {
          checkEmail(body["email"], "/email", errors);
        }
        if (body["role"] !== undefined) checkRole(body["role"], errors);
        failOn(errors);
        const email = body["email"] as string;
        const role = (body["role"] ?? "user") as "admin" | "user";
        const { member, location } = mutate(ctx, cookies, (data, user: SandboxUser) => {
          const { project } = adminAccess(data, user, params.projectId);
          const base = `/api/v1/projects/${lower(project.id)}`;
          // Only admins get this far, so only they learn whether an address is registered.
          const found = data.users.find((u) => lower(u.email) === lower(email));
          if (!found) {
            const invitedEmail = lower(email);
            if (
              data.invitations.some(
                (i) => sameId(i.projectId, project.id) && i.email === invitedEmail,
              )
            ) {
              throw alreadyInvited();
            }
            const invitation = {
              projectId: lower(project.id),
              email: invitedEmail,
              role,
              invitedBy: lower(user.id),
              createdAt: ctx.now().toISOString(),
            };
            data.invitations.push(invitation);
            return {
              member: pendingMemberJson(invitation),
              location: `${base}/invitations/${encodeURIComponent(invitedEmail).replaceAll("%40", "@")}`,
            };
          }
          if (
            data.memberships.some(
              (m) => sameId(m.projectId, project.id) && sameId(m.userId, found.id),
            )
          ) {
            throw alreadyMember();
          }
          const membership = { userId: lower(found.id), projectId: lower(project.id), role };
          data.memberships.push(membership);
          return { member: memberJson(data, membership), location: `${base}/members/${found.id}` };
        });
        return HttpResponse.json(member, { status: 201, headers: { Location: location } });
      }),
    ),

    http.patch("/projects/{projectId}/members/{userId}", ({ params, request, cookies }) =>
      guarded(async () => {
        requireSession(ctx, cookies);
        checkProjectPath(params.projectId);
        checkPathId(params.userId, "userId");
        const body = requiredObject(
          await readJson(request, ["application/merge-patch+json", "application/json"]),
        );
        const errors: ProblemFieldError[] = [];
        if (body["role"] === undefined) {
          errors.push({ pointer: "", detail: "must have required property 'role'" });
        } else {
          checkRole(body["role"], errors);
        }
        failOn(errors);
        const role = body["role"] as "admin" | "user";
        const changed = mutate(ctx, cookies, (data, user) => {
          const { project } = adminAccess(data, user, params.projectId);
          const outcome = decideRoleChange(rowsOf(data, project.id), params.userId, role);
          if (outcome === "not-found") throw notFound();
          if (outcome === "last-admin") throw lastAdmin();
          if (outcome === "changed") {
            for (const m of data.memberships) {
              if (sameId(m.projectId, project.id) && sameId(m.userId, params.userId)) m.role = role;
            }
          }
          return memberJson(data, { userId: params.userId, role });
        });
        return HttpResponse.json(changed);
      }),
    ),

    http.delete("/projects/{projectId}/members/{userId}", ({ params, cookies }) =>
      guarded(() => {
        requireSession(ctx, cookies);
        checkProjectPath(params.projectId);
        checkPathId(params.userId, "userId");
        mutate(ctx, cookies, (data, user) => {
          // Any member may leave; removing someone else takes an admin.
          const { project } = sameId(params.userId, user.id)
            ? accessProject(data, user, params.projectId)
            : adminAccess(data, user, params.projectId);
          const outcome = decideRemoval(rowsOf(data, project.id), params.userId);
          if (outcome === "not-found") throw notFound();
          if (outcome === "last-admin") throw lastAdmin();
          data.memberships = data.memberships.filter(
            (m) => !(sameId(m.projectId, project.id) && sameId(m.userId, params.userId)),
          );
          // The creator marker goes with the creator: a creator added again is not the owner again (R2).
          if (project.creatorId !== null && sameId(project.creatorId, params.userId)) {
            project.creatorId = null;
          }
        });
        return new HttpResponse(null, { status: 204 });
      }),
    ),

    http.delete("/projects/{projectId}/invitations/{email}", ({ params, cookies }) =>
      guarded(() => {
        requireSession(ctx, cookies);
        checkProjectPath(params.projectId);
        const errors: ProblemFieldError[] = [];
        checkEmail(params.email, "/email", errors);
        failOn(errors);
        mutate(ctx, cookies, (data, user) => {
          const { project } = adminAccess(data, user, params.projectId);
          const before = data.invitations.length;
          data.invitations = data.invitations.filter(
            (i) => !(sameId(i.projectId, project.id) && i.email === lower(params.email)),
          );
          if (data.invitations.length === before) throw notFound();
        });
        return new HttpResponse(null, { status: 204 });
      }),
    ),
  ];
}
