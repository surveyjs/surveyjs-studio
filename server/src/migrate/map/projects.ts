import {
  isGuid,
  membershipFromLegacy,
  projectFromLegacy,
  UnmappableLegacyRowError,
} from "../../providers/azure-legacy/mapping.js";
import type {
  LegacyOrganizationRow,
  LegacyOrganizationUserRow,
} from "../../providers/azure-legacy/rows.js";
import type { MemberRec, ProjectRec } from "../records.js";
import type { Report } from "./report.js";

const EPOCH = new Date(0);

/** A member row with its change time (`[timestamp]`, UTC), when the reader has it. */
type MemberRow = LegacyOrganizationUserRow & { timestamp?: Date | null };

/**
 * A project and its members. A project without usable members is skipped and reported. Members:
 * one per (project, user), an admin row winning (as the provider merges them), created at the
 * earliest of the user's rows' times (legacy local times read as UTC) and updated at the latest
 * of their change times (a row without one counts with its own time); a user with only unknown
 * roles is no member, and is reported. The sample selects members by this function too.
 */
export function mapProject(
  org: LegacyOrganizationRow,
  members: readonly MemberRow[],
  report: Report,
): { project: ProjectRec; members: MemberRec[] } | null {
  const projectId = org.id.toLowerCase();
  if (!isGuid(org.id)) {
    report.skip("project", { projectId }, "the id is not a GUID");
    return null;
  }
  const usable = members.filter((row) => {
    if (isGuid(row.id) && isGuid(row.userid)) return true;
    report.skip("member", { projectId, membershipId: row.id.toLowerCase() }, "an id is not a GUID");
    return false;
  });
  let legacy;
  try {
    legacy = projectFromLegacy(org, usable);
  } catch (error) {
    if (!(error instanceof UnmappableLegacyRowError)) throw error;
    report.skip("project", { ...error.ids }, error.message);
    return null;
  }

  const byUser = new Map<string, MemberRow[]>();
  for (const row of usable) {
    const userId = row.userid.toLowerCase();
    byUser.set(userId, [...(byUser.get(userId) ?? []), row]);
  }
  const result: MemberRec[] = [];
  for (const [userId, rows] of byUser) {
    const roles: ("admin" | "user")[] = [];
    for (const row of rows) {
      try {
        roles.push(membershipFromLegacy(legacy, row).role);
      } catch (error) {
        if (!(error instanceof UnmappableLegacyRowError)) throw error;
        report.note("member_role_unknown", { ...error.ids });
      }
    }
    if (roles.length === 0) continue;
    const times = rows.map((row) => (row.happendat ?? EPOCH).getTime());
    const changes = rows.map((row) => (row.timestamp ?? row.happendat ?? EPOCH).getTime());
    result.push({
      projectId,
      userId,
      role: roles.includes("admin") ? "admin" : "user",
      createdAt: new Date(Math.min(...times)).toISOString(),
      updatedAt: new Date(Math.max(...changes)).toISOString(),
    });
  }
  if (result.length === 0) {
    report.skip("project", { projectId }, "no member has a known role");
    return null;
  }
  return {
    project: {
      id: legacy.id,
      name: legacy.name,
      creatorId: legacy.ownerId,
      createdAt: legacy.createdAt,
    },
    members: result,
  };
}
