import { GUID } from "../domain/guid.js";
import type { InvitationStore, ProjectInvitation } from "../providers/types.js";
import type { SqlDatabase } from "./database.js";
import { isoOf } from "./values.js";

/** A GUID as stored (lower-case); null for a value that is not a GUID, which no row can have. */
const key = (id: string): string | null => (GUID.test(id) ? id.toLowerCase() : null);

/** The pending project invitations in the database's `project_invitations` table. */
export function createSqlInvitationStore(database: SqlDatabase): InvitationStore {
  const { db } = database;

  return {
    listInvitations: async (projectId) => {
      const id = key(projectId);
      if (id === null) return [];
      const rows = await db
        .selectFrom("project_invitations")
        .selectAll()
        .where("project_id", "=", id)
        .execute();
      // Sorted here: SQL collations differ between the dialects; emails are stored lower-case.
      return rows
        .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0))
        .map((row): ProjectInvitation => ({
          projectId: row.project_id,
          email: row.email,
          role: row.role,
          invitedBy: row.invited_by,
          createdAt: isoOf(row.created_at),
        }));
    },
    addInvitation: async (invitation) => {
      const projectId = key(invitation.projectId);
      const invitedBy = key(invitation.invitedBy);
      if (projectId === null) return "project-not-found";
      if (invitedBy === null) throw new Error("Inviter ids must be GUIDs");
      return db.transaction().execute(async (trx) => {
        const project = await trx
          .selectFrom("projects")
          .select("id")
          .where("id", "=", projectId)
          .executeTakeFirst();
        if (!project) return "project-not-found" as const;
        const inserted = await trx
          .insertInto("project_invitations")
          .values({
            project_id: projectId,
            email: invitation.email.toLowerCase(),
            role: invitation.role,
            invited_by: invitedBy,
            created_at: isoOf(invitation.createdAt),
          })
          .onConflict((conflict) => conflict.columns(["project_id", "email"]).doNothing())
          .returning("email")
          .executeTakeFirst();
        return inserted ? ("added" as const) : ("already-invited" as const);
      });
    },
    removeInvitation: async (projectId, email) => {
      const id = key(projectId);
      if (id === null) return "not-found";
      const removed = await db
        .deleteFrom("project_invitations")
        .where("project_id", "=", id)
        .where("email", "=", email.toLowerCase())
        .returning("email")
        .executeTakeFirst();
      return removed ? "removed" : "not-found";
    },
    hasInvitation: async (email) => {
      const row = await db
        .selectFrom("project_invitations")
        .select("email")
        .where("email", "=", email.toLowerCase())
        .limit(1)
        .executeTakeFirst();
      return row !== undefined;
    },
    claimInvitations: async (userId, email, { now }) => {
      const user = key(userId);
      if (user === null) return 0;
      const wanted = email.toLowerCase();
      const when = isoOf(now);
      return db.transaction().execute(async (trx) => {
        // Deleted first, in one statement: two claims at once cannot both take the same row.
        const claimed = await trx
          .deleteFrom("project_invitations")
          .where("email", "=", wanted)
          .returning(["project_id", "role"])
          .execute();
        if (claimed.length === 0) return 0;
        const added = await trx
          .insertInto("project_members")
          .values(
            claimed.map((invitation) => ({
              project_id: invitation.project_id,
              user_id: user,
              role: invitation.role,
              created_at: when,
              updated_at: when,
            })),
          )
          .onConflict((conflict) => conflict.columns(["project_id", "user_id"]).doNothing())
          .returning("project_id")
          .execute();
        return added.length;
      });
    },
  };
}
