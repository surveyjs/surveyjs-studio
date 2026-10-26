import { randomUUID } from "node:crypto";
import type { components } from "@surveyjs-studio/contract";
import type { RequestUser } from "../auth/authenticate.js";
import type { Clock } from "../auth/session.js";
import type { ProjectMember, ProjectMembership, ProjectRole } from "../domain/types.js";
import { AppError } from "../errors.js";
import {
  decodeMembersCursor,
  decodeProjectCursor,
  encodeMembersCursor,
  encodeProjectCursor,
  type MemberPosition,
  type ProjectPosition,
} from "../paging/cursor.js";
import { compare } from "../providers/ordering.js";
import type { ProjectStore, UserDirectory } from "../providers/types.js";
import { notFound } from "../surveys/access.js";
import { memberJson, projectJson, type MemberJson, type ProjectJson } from "./json.js";
import { same, surveyReceiver } from "./rules.js";

type ProjectPage = components["schemas"]["ProjectPage"];
type MemberPage = components["schemas"]["MemberPage"];
type ProjectCreate = components["schemas"]["ProjectCreate"];
type ProjectPatch = components["schemas"]["ProjectPatch"];
type MemberPatch = components["schemas"]["MemberPatch"];

/**
 * The `addMember` body after contract validation. The generated type marks `role` required because
 * of its default; validation fills the default (`useDefaults`), and the service keeps its own fallback.
 */
export interface MemberCreate {
  readonly email: string;
  readonly role?: ProjectRole;
}

export interface ProjectsServiceOptions {
  readonly users: UserDirectory;
  readonly projects: ProjectStore;
  /** The clock for creation and change times; default `Date.now`. */
  readonly now?: Clock;
}

/** The `listProjects` and `listMembers` query, after contract validation and defaults. */
export interface ProjectListQuery {
  readonly limit: number;
  readonly cursor?: string;
}

export interface ProjectsService {
  list(user: RequestUser, query: ProjectListQuery): Promise<ProjectPage>;
  get(user: RequestUser, projectId: string): Promise<ProjectJson>;
  create(user: RequestUser, body: ProjectCreate): Promise<ProjectJson>;
  rename(user: RequestUser, projectId: string, patch: ProjectPatch): Promise<ProjectJson>;
  delete(user: RequestUser, projectId: string): Promise<void>;
  members(user: RequestUser, projectId: string, query: ProjectListQuery): Promise<MemberPage>;
  addMember(user: RequestUser, projectId: string, body: MemberCreate): Promise<MemberJson>;
  changeRole(
    user: RequestUser,
    projectId: string,
    userId: string,
    patch: MemberPatch,
  ): Promise<MemberJson>;
  removeMember(user: RequestUser, projectId: string, userId: string): Promise<void>;
}

/** A place in a (lower-cased name, id) list order: a project or a member position. */
type Position = ProjectPosition | MemberPosition;

/** Whether `position` comes strictly after `after` in (name, id) order. */
const isAfter = (position: Position, after: Position): boolean =>
  compare(position.name, after.name) > 0 ||
  (position.name === after.name && compare(position.id, after.id) > 0);

/**
 * The first `limit` items strictly after the cursor's position (the list is whole and in order),
 * and the cursor of the next page.
 */
function pageOf<T, P extends Position>(
  all: readonly T[],
  positionOf: (item: T) => P,
  after: P | undefined,
  limit: number,
  encode: (position: P) => string,
): { items: T[]; nextCursor: string | null } {
  const rest = after ? all.filter((item) => isAfter(positionOf(item), after)) : all;
  const items = rest.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: last !== undefined && rest.length > limit ? encode(positionOf(last)) : null,
  };
}

const projectPosition = ({ project }: ProjectMembership): ProjectPosition => ({
  name: project.name.toLowerCase(),
  id: project.id,
});

const memberPosition = ({ user }: ProjectMember): MemberPosition => ({
  name: user.displayName.toLowerCase(),
  id: user.id,
});

const forbidden = (): AppError =>
  new AppError({
    code: "forbidden",
    status: 403,
    title: "Forbidden",
    detail: "Only project admins can do this.",
  });

const userNotFound = (): AppError =>
  new AppError({
    code: "user-not-found",
    status: 404,
    title: "User not found",
    detail: "No registered user has this email address.",
  });

const alreadyMember = (): AppError =>
  new AppError({
    code: "already-member",
    status: 409,
    title: "Already a member",
    detail: "The user is already a member of this project.",
  });

const lastAdmin = (): AppError =>
  new AppError({
    code: "last-admin",
    status: 409,
    title: "Last admin",
    detail: "A project must keep at least one admin.",
  });

/** A 422 for a blank name (R14); names are stored as sent, so only this is checked. */
function checkName(name: string | undefined): void {
  if (name !== undefined && name.trim() === "") {
    throw new AppError({
      code: "validation-failed",
      status: 422,
      title: "Validation failed",
      errors: [{ pointer: "/name", detail: "must not be blank" }],
    });
  }
}

/** The projects of a user, and their members (ADR 0009: access through membership). */
export function createProjectsService(options: ProjectsServiceOptions): ProjectsService {
  const { users, projects, now = Date.now } = options;
  const isoNow = (): string => new Date(now()).toISOString();

  /** The user's membership of the project; a project of others answers like an unknown one. */
  async function access(user: RequestUser, projectId: string): Promise<ProjectMembership> {
    const membership = await projects.getUserProject(user.id, projectId);
    if (!membership) throw notFound();
    return membership;
  }

  /** `access`, and the user is an admin of the project (403 otherwise). */
  async function adminAccess(user: RequestUser, projectId: string): Promise<ProjectMembership> {
    const membership = await access(user, projectId);
    if (membership.role !== "admin") throw forbidden();
    return membership;
  }

  return {
    async list(user, { limit, cursor }) {
      const after = cursor === undefined ? undefined : decodeProjectCursor(cursor);
      // The project store returns the whole list in project list order; the service cuts the page.
      const all = await projects.listUserProjects(user.id);
      const page = pageOf(all, projectPosition, after, limit, encodeProjectCursor);
      return { items: page.items.map(projectJson), nextCursor: page.nextCursor };
    },

    async get(user, projectId) {
      return projectJson(await access(user, projectId));
    },

    async create(user, { name }) {
      checkName(name);
      const membership = await projects.createProject({
        id: randomUUID(),
        name,
        creatorId: user.id,
        createdAt: isoNow(),
      });
      return projectJson(membership);
    },

    async rename(user, projectId, { name }) {
      checkName(name);
      const { project } = await adminAccess(user, projectId);
      // A patch without a name (only unknown members) changes nothing.
      if (name !== undefined) {
        const renamed = await projects.renameProject(project.id, name, { now: isoNow() });
        if (!renamed) throw notFound();
      }
      return projectJson(await access(user, project.id));
    },

    async delete(user, projectId) {
      const { project } = await adminAccess(user, projectId);
      const members = await projects.listMembers(project.id);
      const receiverId = surveyReceiver(
        project.ownerId,
        members.map((m) => m.user.id),
        user.id,
      );
      const moved = await projects.deleteProject(project.id, { receiverId, now: isoNow() });
      if (moved === null) throw notFound();
    },

    async members(user, projectId, { limit, cursor }) {
      const { project } = await access(user, projectId);
      const after = cursor === undefined ? undefined : decodeMembersCursor(cursor, project.id);
      // The project store returns every visible member in member list order; the service cuts the page.
      const all = await projects.listMembers(project.id);
      const page = pageOf(all, memberPosition, after, limit, (position) =>
        encodeMembersCursor(position, project.id),
      );
      return { items: page.items.map(memberJson), nextCursor: page.nextCursor };
    },

    async addMember(user, projectId, { email, role = "user" }) {
      const { project } = await adminAccess(user, projectId);
      // Only admins get this far, so only they learn whether an address is registered.
      const found = await users.findUserByEmail(email);
      if (!found) throw userNotFound();
      const outcome = await projects.addMember(project.id, found.id, role, { now: isoNow() });
      if (outcome === "already-member") throw alreadyMember();
      if (outcome === "not-found") throw notFound();
      return memberJson({ user: found, role });
    },

    async changeRole(user, projectId, userId, { role }) {
      const { project } = await adminAccess(user, projectId);
      const outcome = await projects.setMemberRole(project.id, userId, role, { now: isoNow() });
      if (outcome === "not-found") throw notFound();
      if (outcome === "last-admin") throw lastAdmin();
      // The user is read after the write, for the answer only. If the user directory fails here
      // (surveyjs-api down), the role change is already stored and the client gets a 500; a retry
      // finds the role `unchanged` and answers with the member. Low impact, so the order stays.
      const target = await users.getUser(userId);
      if (!target) throw notFound();
      return memberJson({ user: target, role });
    },

    async removeMember(user, projectId, userId) {
      // Any member may leave; removing someone else takes an admin.
      const { project } = same(userId, user.id)
        ? await access(user, projectId)
        : await adminAccess(user, projectId);
      const outcome = await projects.removeMember(project.id, userId);
      if (outcome === "not-found") throw notFound();
      if (outcome === "last-admin") throw lastAdmin();
    },
  };
}
