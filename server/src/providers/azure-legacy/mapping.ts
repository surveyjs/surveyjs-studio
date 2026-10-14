import type {
  ProjectMembership,
  ProjectRole,
  SurveyRecord,
  SurveyResponse,
  User,
} from "../../domain/types.js";
import type {
  LegacyOrganizationRow,
  LegacyOrganizationUserRow,
  LegacyResultEntity,
  LegacySurveyRow,
  LegacyUserRow,
} from "./rows.js";

/** Pure legacy -> domain mapping. Rules: docs/architecture/legacy-data-layout.md section 9. */

const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

const guid = (value: string): string => value.toLowerCase();
const flag = (value: number | null): boolean => value === 1;

export function surveyFromLegacy(
  row: LegacySurveyRow,
  ownerKind: "personal" | "project",
): SurveyRecord {
  const ownerId = guid(row.userid);
  const creatorId = guid(row.creatorid);
  return {
    id: guid(row.id),
    name: row.name,
    owner:
      ownerKind === "personal"
        ? { kind: "personal", userId: ownerId }
        : { kind: "project", projectId: ownerId },
    creatorId: creatorId === ZERO_GUID ? null : creatorId,
    postId: guid(row.postid),
    resultId: guid(row.resultid),
    published: flag(row.ispublished),
    archived: flag(row.isarchived),
    createdAt: row.createdat.toISOString(),
    updatedAt: row.timestamp.toISOString(),
    settings: {
      publicResults: flag(row.allowaccessresult),
      // The legacy reader parses this varchar column with GetValue<bool>: only "1" is true.
      storeRespondentIp: row.storeipaddress === "1",
      useCookies: flag(row.usecookies),
    },
  };
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
  const displayName = row.displayname?.trim() ? row.displayname : row.email;
  return { id: guid(row.id), email: row.email, displayName, blocked: flag(row.blocked) };
}

export function membershipFromLegacy(
  org: LegacyOrganizationRow,
  member: LegacyOrganizationUserRow,
): ProjectMembership {
  return { project: { id: guid(org.id), name: org.name }, role: roleFromLegacy(member.role) };
}

function roleFromLegacy(role: string): ProjectRole {
  const normalised = role.toLowerCase();
  if (normalised === "admin" || normalised === "user") return normalised;
  throw new Error(`Unknown project role in legacy data: "${role}"`);
}
