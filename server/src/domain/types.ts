/** Who owns a survey: a user (personal) or a project. */
export type SurveyOwner =
  | { readonly kind: "personal"; readonly userId: string }
  | { readonly kind: "project"; readonly projectId: string };

export interface SurveyRecord {
  readonly id: string;
  readonly name: string;
  readonly owner: SurveyOwner;
  readonly creatorId: string | null; // legacy all-zero GUID -> null
  readonly postId: string;
  readonly resultId: string;
  readonly published: boolean; // legacy NULL -> false
  readonly archived: boolean;
  readonly createdAt: string; // ISO 8601 UTC, Date#toISOString() format
  readonly updatedAt: string; // ISO 8601 UTC (legacy Surveys.timestamp)
  readonly settings: {
    readonly publicResults: boolean;
    readonly storeRespondentIp: boolean;
    readonly useCookies: boolean;
  };
}

export type SurveyDefinition = Record<string, unknown>;

/** Everything the service decides for a new survey; the store adds the legacy defaults. */
export interface NewSurvey {
  readonly id: string; // lower-case GUID
  readonly name: string;
  readonly owner: SurveyOwner;
  readonly creatorId: string; // the signed-in user
  readonly postId: string; // lower-case GUID, independent
  readonly resultId: string; // lower-case GUID, independent
  readonly createdAt: string; // ISO 8601 UTC (Date#toISOString)
  readonly updatedAt: string; // equal to createdAt
}

export interface User {
  readonly id: string;
  readonly email: string;
  readonly displayName: string; // fallback: email when legacy displayname is null/blank
  readonly blocked: boolean;
}

export type ProjectRole = "admin" | "user";

/** A project as the Directory returns it (contract `Project` minus the caller's `role`). */
export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly createdAt: string; // ISO 8601 UTC
  readonly memberCount: number; // >= 1
}

export interface ProjectMembership {
  readonly project: ProjectRecord;
  readonly role: ProjectRole;
}

export interface SurveyResponse {
  readonly id: string; // legacy InstanceId (row `id` / RowKey)
  readonly submittedAt: string; // legacy HappendAt, ISO 8601 UTC
  readonly data: Record<string, unknown>; // JSON.parse(result), no entity decoding
  readonly clientId?: string;
  readonly respondentIp?: string;
  readonly partial: boolean; // missing -> false
}
