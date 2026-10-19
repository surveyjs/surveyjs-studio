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

export type SurveyTheme = Record<string, unknown>;

/** A survey record change; every member is optional except `updatedAt`. */
export interface SurveyChanges {
  readonly name?: string;
  /** A move: the new scope, and the user who moved it (legacy overwrites the creator). */
  readonly move?: { readonly owner: SurveyOwner; readonly creatorId: string };
  readonly published?: boolean;
  readonly archived?: boolean;
  readonly settings?: { readonly publicResults?: boolean; readonly storeRespondentIp?: boolean };
  /** ISO 8601 UTC; always set. */
  readonly updatedAt: string;
}

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

/** A response to store (S5-S8). */
export interface NewResponse {
  /** GUID, any case (stored lower-case): responseIdFor(survey.id, key) with a key, else randomUUID(). */
  readonly id: string;
  /** ISO 8601 UTC with milliseconds (Date#toISOString of the server clock). */
  readonly submittedAt: string;
  readonly data: Record<string, unknown>;
  /** Contract ClientId: 1-256 characters. */
  readonly clientId?: string;
  /** Only when the survey's storeRespondentIp is on (S8). */
  readonly respondentIp?: string;
}

/** A client's completion marker (S3): none, a legacy partial marker, or a complete one. */
export type CompletionState = "none" | "partial" | "completed";

export interface ResultStatsRecord {
  readonly count: number;
  /** ISO 8601 UTC; null when there are no responses. */
  readonly firstSubmittedAt: string | null;
  readonly lastSubmittedAt: string | null;
}

/** A stored document and its version token (opaque, never contains `"`). */
export interface Versioned<T> {
  readonly content: T;
  readonly version: string;
}

/** One saved version of a survey definition. */
export interface HistoryEntryRecord {
  /** Lower-case GUID (azure: the point blob's name after `{surveyId}/`). */
  readonly id: string;
  /** ISO 8601 UTC. */
  readonly at: string;
  /** The user who saved; null for legacy entries. */
  readonly userId: string | null;
}

export type SaveOutcome =
  | { readonly kind: "saved"; readonly version: string }
  | { readonly kind: "conflict" }
  | { readonly kind: "not-found" };

/** What a stored file is for: editor assets (Step 7) and respondent files (Step 8, S11). */
export type FileKind = "asset" | "response";

export interface StoredFileRecord {
  /** 64 lower-case hex digits (R1). */
  readonly id: string;
  /** Lower-case GUID of the owning survey (equals surveyIdOfFile(id)). */
  readonly surveyId: string;
  readonly kind: FileKind;
  /** The uploaded name (R12), any Unicode, 1–255 UTF-16 code units. */
  readonly name: string;
  /** One of the allowed types (R6). */
  readonly contentType: string;
  /** Bytes. */
  readonly size: number;
  /** ISO 8601 UTC. */
  readonly createdAt: string;
}
