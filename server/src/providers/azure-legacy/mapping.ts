import type {
  ProjectMembership,
  ProjectRecord,
  SurveyDefinition,
  SurveyRecord,
  SurveyResponse,
  User,
} from "../../domain/types.js";
import type {
  LegacyLicenceRow,
  LegacyOrganizationRow,
  LegacyOrganizationUserRow,
  LegacyResultEntity,
  LegacySurveyRow,
  LegacyUserRow,
} from "./rows.js";

/**
 * Pure legacy -> domain mapping. Rules: docs/architecture/legacy-data-layout.md section 9.
 * NULL columns get defaults where the domain can still represent the row; otherwise the mapping
 * throws UnmappableLegacyRowError, which carries only row ids, so a caller can skip the row.
 */

const ZERO_GUID = "00000000-0000-0000-0000-000000000000";
const EPOCH = new Date(0);

/** A legacy row the domain cannot represent. `ids` holds lower-case row ids only, never content. */
export class UnmappableLegacyRowError extends Error {
  constructor(
    readonly ids: Readonly<Record<string, string>>,
    reason: string,
  ) {
    super(`Legacy row cannot be mapped: ${reason}`);
    this.name = "UnmappableLegacyRowError";
  }
}

const guid = (value: string): string => value.toLowerCase();

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A GUID with dashes, in any case: the only id form the legacy stores hold. */
export const isGuid = (value: string): boolean => GUID.test(value);

const flag = (value: number | null): boolean => value === 1;

export function surveyFromLegacy(
  row: LegacySurveyRow,
  ownerKind: "personal" | "project",
): SurveyRecord {
  const id = guid(row.id);
  const required = (column: "userid" | "postid" | "resultid"): string => {
    const value = row[column];
    if (value === null) throw new UnmappableLegacyRowError({ surveyId: id }, `NULL ${column}`);
    return guid(value);
  };
  const ownerId = required("userid");
  const postId = required("postid");
  const resultId = required("resultid");
  const creatorId = row.creatorid === null ? ZERO_GUID : guid(row.creatorid);
  const createdAt = row.createdat ?? row.timestamp ?? EPOCH;
  const updatedAt = row.timestamp ?? row.createdat ?? EPOCH;
  return {
    id,
    name: row.name ?? "",
    owner:
      ownerKind === "personal"
        ? { kind: "personal", userId: ownerId }
        : { kind: "project", projectId: ownerId },
    creatorId: creatorId === ZERO_GUID ? null : creatorId,
    postId,
    resultId,
    published: flag(row.ispublished),
    archived: flag(row.isarchived),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    settings: {
      publicResults: flag(row.allowaccessresult),
      // The legacy reader parses this varchar column with GetValue<bool>: only "1" is true.
      storeRespondentIp: row.storeipaddress === "1",
      useCookies: flag(row.usecookies),
    },
  };
}

/**
 * A survey definition from the text of its `surveyjson` blob (layout section 3.2). An empty blob
 * is an empty survey; text that is not a JSON object cannot be represented.
 */
export function definitionFromLegacy(surveyId: string, text: string): SurveyDefinition {
  if (text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UnmappableLegacyRowError({ surveyId: guid(surveyId) }, "definition is not JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new UnmappableLegacyRowError(
      { surveyId: guid(surveyId) },
      "definition is not a JSON object",
    );
  }
  return parsed as SurveyDefinition;
}

export function responseFromLegacy(entity: LegacyResultEntity): SurveyResponse {
  return {
    id: guid(entity.id),
    submittedAt: entity.happendat.toISOString(),
    data: JSON.parse(entity.result) as Record<string, unknown>,
    ...(entity.clientid ? { clientId: entity.clientid } : {}),
    ...(entity.ipaddress ? { respondentIp: entity.ipaddress } : {}),
    partial: entity.ispartialcompleted === true,
  };
}

export function userFromLegacy(row: LegacyUserRow): User {
  const email = row.email ?? "";
  const displayName = row.displayname?.trim() ? row.displayname : email;
  return { id: guid(row.id), email, displayName, blocked: flag(row.blocked) };
}

/** Code-point order, as in ordering.ts. */
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Earliest `happendat` first (NULL last), then the smaller user id, then the smaller row id. */
function earliest(
  rows: readonly LegacyOrganizationUserRow[],
): LegacyOrganizationUserRow | undefined {
  const time = (row: LegacyOrganizationUserRow) => row.happendat?.getTime() ?? Infinity;
  return [...rows].sort(
    (a, b) =>
      time(a) - time(b) ||
      compareText(guid(a.userid), guid(b.userid)) ||
      compareText(guid(a.id), guid(b.id)),
  )[0];
}

/**
 * A project from its `Organizations` row and every `OrganizationUsers` row of it. Legacy has no
 * owner or creation column (layout 3.12, 9.3), so both are inferred: the creator's membership row
 * (its id equals the project id) decides; without it the earliest admin owns the project, else the
 * earliest member. The creation time is the creator row's `happendat`, else the project's
 * `happendat` (which moves on rename), else the epoch.
 */
export function projectFromLegacy(
  org: LegacyOrganizationRow,
  members: readonly LegacyOrganizationUserRow[],
): ProjectRecord {
  const id = guid(org.id);
  const creator = members.find((row) => guid(row.id) === id);
  const owner =
    creator ??
    earliest(members.filter((row) => row.role?.toLowerCase() === "admin")) ??
    earliest(members);
  if (!owner) throw new UnmappableLegacyRowError({ organizationId: id }, "project without members");
  return {
    id,
    name: org.name ?? "",
    ownerId: guid(owner.userid),
    createdAt: (creator?.happendat ?? org.happendat ?? EPOCH).toISOString(),
    memberCount: members.length,
  };
}

/** The membership of one `OrganizationUsers` row in a project built by projectFromLegacy. */
export function membershipFromLegacy(
  project: ProjectRecord,
  member: LegacyOrganizationUserRow,
): ProjectMembership {
  const normalised = member.role?.toLowerCase();
  if (normalised !== "admin" && normalised !== "user") {
    throw new UnmappableLegacyRowError(
      { membershipId: guid(member.id), organizationId: guid(member.organizationid) },
      member.role === null ? "NULL project role" : "unknown project role",
    );
  }
  return { project, role: normalised };
}

/**
 * The expiry of each licence of a user, as the legacy licence list resolves it (layout section
 * 3.15): a developer seat (non-empty `parentlicenseid`) takes its parent's expiry; any other
 * licence keeps its own. NULL stays null. A seat whose parent row is missing throws, because the
 * legacy site then fails the whole check and shows no dialog.
 */
export function licenceExpiriesFromLegacy(rows: readonly LegacyLicenceRow[]): (Date | null)[] {
  return rows.map((row) => {
    const parent = row.parentlicenseid === null ? ZERO_GUID : guid(row.parentlicenseid);
    if (parent === ZERO_GUID) return row.expirationdate;
    if (row.parentid === null) {
      throw new UnmappableLegacyRowError(
        { licenceId: guid(row.id) },
        "developer seat without its parent licence",
      );
    }
    return row.parentexpirationdate;
  });
}
