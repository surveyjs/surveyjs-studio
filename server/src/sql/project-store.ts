import type { Kysely } from "kysely";
import { GUID } from "../domain/guid.js";
import type { ProjectMember, ProjectMembership, ProjectRole, User } from "../domain/types.js";
import {
  decideMemberErasure,
  decideRemoval,
  decideRoleChange,
  isAdminRole,
  type ErasureFacts,
} from "../projects/rules.js";
import { memberListOrder, projectListOrder } from "../providers/ordering.js";
import type { ProjectStore, UserDirectory } from "../providers/types.js";
import type { SqlDatabase } from "./database.js";
import type { DatabaseSchema } from "./schema.js";
import { isoOf } from "./values.js";

/** A GUID as stored (lower-case); null for a value that is not a GUID, which no row can have. */
const key = (id: string): string | null => (GUID.test(id) ? id.toLowerCase() : null);

/** Distinct values in ascending code-point order. */
const distinctSorted = (values: readonly string[]): string[] => [...new Set(values)].sort();

/**
 * The project store on SQLite or PostgreSQL (docs/architecture/data-model.md). Member users are
 * resolved through `users`, the provider set's user directory (R6, R11): a row whose user the
 * directory does not know is an orphan, counted but neither shown nor an admin. The last-admin
 * rule and project deletion run inside transactions; on PostgreSQL the project row is locked
 * first, so two role changes of one project are decided one after the other.
 */
export function createSqlProjectStore(database: SqlDatabase, users: UserDirectory): ProjectStore {
  const { db } = database;

  /** Locks the project row for this transaction (PostgreSQL); false when there is no project. */
  const lockProject = async (trx: Kysely<DatabaseSchema>, project: string): Promise<boolean> => {
    let query = trx.selectFrom("projects").select("id").where("id", "=", project);
    if (database.dialect === "postgres") query = query.forUpdate();
    return (await query.executeTakeFirst()) !== undefined;
  };

  /** The project's rows as the rules see them, with each user as the directory knows them. */
  const factsOf = async (
    trx: Kysely<DatabaseSchema>,
    project: string,
  ): Promise<(ErasureFacts & { user: User | null })[]> => {
    const rows = await trx
      .selectFrom("project_members")
      .select(["user_id", "role"])
      .where("project_id", "=", project)
      .execute();
    return Promise.all(
      rows.map(async (row) => {
        const user = await users.getUser(row.user_id);
        return {
          userId: row.user_id,
          role: row.role,
          userExists: user !== null,
          displayName: user?.displayName ?? "",
          user,
        };
      }),
    );
  };

  /** Memberships with the project as stored now: the owner while the creator is a member (R2). */
  const memberships = async (userId: string, projectId?: string): Promise<ProjectMembership[]> => {
    let query = db
      .selectFrom("project_members as m")
      .innerJoin("projects as p", "p.id", "m.project_id")
      .select((eb) => [
        "p.id",
        "p.name",
        "p.creator_id",
        "p.created_at",
        "m.role",
        eb
          .selectFrom("project_members as c")
          .select((c) => c.fn.countAll<number | string | bigint>().as("n"))
          .whereRef("c.project_id", "=", "p.id")
          .as("member_count"),
        eb
          .selectFrom("project_members as o")
          .select("o.user_id")
          .whereRef("o.project_id", "=", "p.id")
          .whereRef("o.user_id", "=", "p.creator_id")
          .as("owner_row"),
      ])
      .where("m.user_id", "=", userId);
    if (projectId !== undefined) query = query.where("p.id", "=", projectId);
    const rows = await query.execute();
    return rows.map((row) => ({
      project: {
        id: row.id,
        name: row.name,
        ownerId: row.owner_row === null ? null : row.creator_id,
        createdAt: isoOf(row.created_at),
        memberCount: Number(row.member_count),
      },
      role: isAdminRole(row.role) ? "admin" : "user",
    }));
  };

  /** Clears the creator marker when the creator's rows go: a creator added again is not the owner again (R2). */
  const dropCreator = (trx: Kysely<DatabaseSchema>, project: string, user: string) =>
    trx
      .updateTable("projects")
      .set({ creator_id: null })
      .where("id", "=", project)
      .where("creator_id", "=", user)
      .execute();

  return {
    listUserProjects: async (userId) => {
      const user = key(userId);
      return user === null ? [] : (await memberships(user)).sort(projectListOrder);
    },
    getUserProject: async (userId, projectId) => {
      const user = key(userId);
      const project = key(projectId);
      if (user === null || project === null) return null;
      return (await memberships(user, project))[0] ?? null;
    },
    listMembers: async (projectId) => {
      const project = key(projectId);
      if (project === null) return [];
      const facts = await factsOf(db, project);
      const byUser = new Map<string, ProjectMember>();
      for (const row of facts) {
        if (row.user === null) continue; // an orphan row is not shown (R11)
        const admin = isAdminRole(row.role) || byUser.get(row.user.id)?.role === "admin";
        byUser.set(row.user.id, { user: row.user, role: admin ? "admin" : "user" });
      }
      return [...byUser.values()].sort(memberListOrder);
    },
    createProject: async ({ id, name, creatorId, createdAt }) => {
      const project = key(id);
      const creator = key(creatorId);
      if (project === null || creator === null) throw new Error("Project ids must be GUIDs");
      const at = isoOf(createdAt);
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto("projects")
          .values({ id: project, name, creator_id: creator, created_at: at })
          .execute();
        await trx
          .insertInto("project_members")
          .values({
            project_id: project,
            user_id: creator,
            role: "admin",
            created_at: at,
            updated_at: at,
          })
          .execute();
      });
      return (await memberships(creator, project))[0]!;
    },
    renameProject: async (projectId, name) => {
      const project = key(projectId);
      if (project === null) return false;
      const result = await db
        .updateTable("projects")
        .set({ name })
        .where("id", "=", project)
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    },
    deleteProject: async (projectId, { receiverId, now }) => {
      const project = key(projectId);
      if (project === null) return null;
      return db.transaction().execute(async (trx) => {
        if (!(await lockProject(trx, project))) return null;
        const moved = await trx
          .selectFrom("surveys")
          .select("id")
          .where("owner_project_id", "=", project)
          .execute();
        // The id, creator, published, archived and settings stay (R9).
        await trx
          .updateTable("surveys")
          .set({
            owner_user_id: receiverId.toLowerCase(),
            owner_project_id: null,
            updated_at: isoOf(now),
          })
          .where("owner_project_id", "=", project)
          .execute();
        await trx.deleteFrom("projects").where("id", "=", project).execute();
        return moved.map((row) => row.id).sort();
      });
    },
    addMember: async (projectId, userId, role, { now }) => {
      const project = key(projectId);
      const user = key(userId);
      if (project === null || user === null) return "not-found";
      return db.transaction().execute(async (trx) => {
        if (!(await lockProject(trx, project))) return "not-found";
        const existing = await trx
          .selectFrom("project_members")
          .select("user_id")
          .where("project_id", "=", project)
          .where("user_id", "=", user)
          .executeTakeFirst();
        if (existing) return "already-member";
        const at = isoOf(now);
        await trx
          .insertInto("project_members")
          .values({ project_id: project, user_id: user, role, created_at: at, updated_at: at })
          .execute();
        return "added";
      });
    },
    setMemberRole: async (projectId, userId, role: ProjectRole, { now }) => {
      const project = key(projectId);
      if (project === null) return "not-found";
      return db.transaction().execute(async (trx) => {
        if (!(await lockProject(trx, project))) return "not-found";
        const outcome = decideRoleChange(await factsOf(trx, project), userId, role);
        if (outcome === "changed") {
          await trx
            .updateTable("project_members")
            .set({ role, updated_at: isoOf(now) })
            .where("project_id", "=", project)
            .where("user_id", "=", userId.toLowerCase())
            .execute();
        }
        return outcome;
      });
    },
    removeMember: async (projectId, userId) => {
      const project = key(projectId);
      if (project === null) return "not-found";
      return db.transaction().execute(async (trx) => {
        if (!(await lockProject(trx, project))) return "not-found";
        const outcome = decideRemoval(await factsOf(trx, project), userId);
        if (outcome === "removed") {
          const user = userId.toLowerCase();
          await trx
            .deleteFrom("project_members")
            .where("project_id", "=", project)
            .where("user_id", "=", user)
            .execute();
          await dropCreator(trx, project, user);
        }
        return outcome;
      });
    },
    eraseMember: async (projectId, userId, { now }) => {
      const project = key(projectId);
      const user = key(userId);
      if (project === null || user === null) return { kind: "not-member" };
      return db.transaction().execute(async (trx) => {
        if (!(await lockProject(trx, project))) return { kind: "not-member" };
        const decision = decideMemberErasure(await factsOf(trx, project), user);
        if (decision.kind === "remove" || decision.kind === "promote") {
          await trx
            .deleteFrom("project_members")
            .where("project_id", "=", project)
            .where("user_id", "=", user)
            .execute();
          if (decision.kind === "promote") {
            await trx
              .updateTable("project_members")
              .set({ role: "admin", updated_at: isoOf(now) })
              .where("project_id", "=", project)
              .where("user_id", "=", decision.successorId.toLowerCase())
              .execute();
          }
          await dropCreator(trx, project, user);
        }
        return decision;
      });
    },
    listMemberUserIds: async () => {
      const rows = await db.selectFrom("project_members").select("user_id").distinct().execute();
      return distinctSorted(rows.map((row) => row.user_id));
    },
    // A membership cannot outlive its project here (the foreign key cascades).
    listUserProjectIds: async (userId) => {
      const user = key(userId);
      if (user === null) return [];
      const rows = await db
        .selectFrom("project_members")
        .select("project_id")
        .where("user_id", "=", user)
        .execute();
      return distinctSorted(rows.map((row) => row.project_id));
    },
  };
}
