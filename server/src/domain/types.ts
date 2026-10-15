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

export interface User {
  readonly id: string;
  readonly email: string;
  readonly displayName: string; // fallback: email when legacy displayname is null/blank
  readonly blocked: boolean;
}

export type ProjectRole = "admin" | "user";

export interface ProjectMembership {
  readonly project: { readonly id: string; readonly name: string };
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
