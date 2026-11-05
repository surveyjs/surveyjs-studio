// The sandbox seed: a JSON-serialisable projection of the server's `MemorySeed`
// (server/src/providers/memory.ts) restricted to the ids in server/fixtures/sandbox.json.
// Generated into seed.json by `pnpm sandbox:seed`. Types only: the web never imports `server/`.
// Every date is an ISO 8601 UTC string, every id a lower-case GUID string.

export type SandboxRole = "admin" | "user";
export type SandboxViewName = "summary" | "table";

/** A survey definition or theme: any JSON object. */
export type SandboxJson = Record<string, unknown>;

/** `MemorySeed.users` (a `User`). */
export interface SandboxUser {
  /** The user id. */
  id: string;
  email: string;
  displayName: string;
  /** A blocked user cannot sign in. */
  blocked: boolean;
}

/** `MemorySeed.projects` (a `MemorySeedProject`). */
export interface SandboxProject {
  id: string;
  name: string;
  /** The creator, the project's owner while they have a membership; null when none. */
  creatorId: string | null;
  /** ISO 8601 UTC. */
  createdAt: string;
}

/** `MemorySeed.memberships`. */
export interface SandboxMembership {
  userId: string;
  projectId: string;
  role: SandboxRole;
}

/** `MemorySeed.invitations` (a `ProjectInvitation`): a pending invitation. */
export interface SandboxInvitation {
  projectId: string;
  /** Lower-case. */
  email: string;
  role: SandboxRole;
  /** The user id of the member who invited. */
  invitedBy: string;
  /** ISO 8601 UTC. */
  createdAt: string;
}

/** `MemorySeed.surveys` (a `SurveyRecord`). */
export interface SandboxSurvey {
  id: string;
  name: string;
  /** Personal (a user) or a project. */
  owner: { kind: "personal"; userId: string } | { kind: "project"; projectId: string };
  /** The user who created it; null for none. */
  creatorId: string | null;
  /** The id the survey runs under (the public link). */
  postId: string;
  /** The id its results are kept under. */
  resultId: string;
  published: boolean;
  archived: boolean;
  /** ISO 8601 UTC. */
  createdAt: string;
  /** ISO 8601 UTC. */
  updatedAt: string;
  settings: { publicResults: boolean; storeRespondentIp: boolean; useCookies: boolean };
}

/** `MemorySeed.history` entries: one saved point of a definition. */
export interface SandboxHistoryEntry {
  id: string;
  /** ISO 8601 UTC. */
  at: string;
  /** Who saved: null in the seed (and for legacy entries). */
  userId: string | null;
}

/** `MemorySeed.responses` entries (a `SurveyResponse`). */
export interface SandboxResponse {
  id: string;
  /** ISO 8601 UTC. */
  submittedAt: string;
  data: Record<string, unknown>;
  clientId?: string;
  respondentIp?: string;
  /** True for a partial (unfinished) response. */
  partial: boolean;
}

export interface SandboxSeed {
  readonly version: 1;
  users: SandboxUser[];
  projects: SandboxProject[];
  memberships: SandboxMembership[];
  invitations: SandboxInvitation[];
  surveys: SandboxSurvey[];
  /** `MemorySeed.definitions`, by survey id. */
  definitions: Record<string, SandboxJson>;
  /** `MemorySeed.themes`, by survey id. */
  themes: Record<string, SandboxJson>;
  /** `MemorySeed.history`, by survey id. */
  history: Record<string, SandboxHistoryEntry[]>;
  /** `MemorySeed.responses`, by survey id. */
  responses: Record<string, SandboxResponse[]>;
  /** `MemorySeed.completions`, by survey id, then client id. */
  completions: Record<string, Record<string, { partial: boolean }>>;
  /** `MemorySeed.legacyViews`: the legacy summary and table layouts, by survey id. */
  legacyViews: Record<string, Partial<Record<SandboxViewName, Record<string, unknown>>>>;
  /** `MemorySeed.privateResultQuestions`: question names hidden from public results, by survey id. */
  privateResultQuestions: Record<string, string[]>;
}
