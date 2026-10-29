import type { Readable } from "node:stream";
import type {
  CompletionState,
  FileKind,
  HistoryEntryRecord,
  NewProject,
  NewResponse,
  NewSurvey,
  ProjectMember,
  ProjectMembership,
  ProjectRole,
  SurveyChanges,
  SurveyDefinition,
  SurveyOwner,
  SurveyRecord,
  ResultStatsRecord,
  SaveOutcome,
  StoredFileRecord,
  SurveyResponse,
  SurveyTheme,
  User,
  Versioned,
  ViewName,
  ViewState,
} from "../domain/types.js";
import type { IdentityClaims } from "../auth/identity.js";
import type { AccountNotices } from "../notices/account-notices.js";

/** A place in the survey list order (updatedAt descending, then id ascending). */
export interface SurveyPosition {
  readonly updatedAt: string;
  readonly id: string;
}

export interface SurveyPageQuery {
  readonly owner: SurveyOwner;
  readonly archived: boolean;
  /** Only surveys after this position in list order. */
  readonly after?: SurveyPosition;
  /** 1–200. */
  readonly limit: number;
}

export interface SurveyPage {
  /** At most `limit` items, in list order. May be shorter than `limit` even when more follow (skipped legacy rows). */
  readonly items: SurveyRecord[];
  /** Position of the last row this page covered when more rows follow; null on the last page. */
  readonly next: SurveyPosition | null;
}

/** A place in the history order (at descending, then id descending). */
export interface HistoryPosition {
  readonly at: string;
  readonly id: string;
}

export interface HistoryQuery {
  readonly surveyId: string;
  /** Entries strictly after this one in history order. */
  readonly after?: HistoryPosition;
  readonly limit: number;
}

export interface HistoryPage {
  readonly items: readonly HistoryEntryRecord[];
  /** The position of the last item when more entries follow; else null. */
  readonly next: HistoryPosition | null;
}

/** A place in submission order (submittedAt ascending, then id ascending). */
export interface ResponsePosition {
  /** ISO 8601 UTC as Date#toISOString writes it. */
  readonly submittedAt: string;
  /** Lower-case response id. */
  readonly id: string;
}

export interface ResponsePageQuery {
  /** Only responses after this position in submission order. */
  readonly after?: ResponsePosition;
  /** 1–1000. */
  readonly limit: number;
}

export interface ResponsePage {
  /**
   * At most `limit` responses, in submission order. May be shorter than `limit` even when more
   * follow (legacy rows the domain cannot represent are skipped, never repeated).
   */
  readonly items: SurveyResponse[];
  /** Position of the last row this page covered when more rows follow; null on the last page. */
  readonly next: ResponsePosition | null;
}

export interface CloneOptions {
  /**
   * Applied to the source's stored definition text and theme text before they are stored for the copy
   * (memory: `JSON.stringify` of the stored object, parsed back after). The copy's history entry holds
   * the rewritten definition. Absent: the copy is made exactly as in Step 5.
   */
  readonly rewriteText?: (text: string) => string;
}

export interface StoredFileContent {
  readonly file: StoredFileRecord;
  /** The bytes, streamed. The reader consumes it to the end or destroys it. */
  readonly content: Readable;
}

export interface FileStore {
  /**
   * Stores a new file. `content.length` equals `file.size`. Rejects when a file with this id exists
   * (nothing is changed then).
   */
  putFile(file: StoredFileRecord, content: Buffer): Promise<void>;
  /** The file and its bytes; null for an unknown or malformed id. Ids match case-insensitively. */
  getFile(id: string): Promise<StoredFileContent | null>;
  /** Sum of `size` over the survey's files of this kind; 0 when it has none. */
  usage(surveyId: string, kind: FileKind): Promise<number>;
  /** Deletes one file; false when there was none (or the id is malformed). */
  deleteFile(id: string): Promise<boolean>;
  /**
   * Deletes the survey's files of `kind`, or of every kind when `kind` is absent; returns how many
   * were deleted. 0 for a non-GUID id or a survey without files.
   */
  deleteSurveyFiles(surveyId: string, kind?: FileKind): Promise<number>;
  /**
   * Copies each asset of `fromSurveyId` to `toSurveyId` under a new id (`newFileId(toSurveyId)`), with the
   * same name, type and bytes and `createdAt` = `copiedAt`. Returns old id → new id (empty when none).
   * On a failure part-way it deletes the copies it made, then rejects.
   */
  copySurveyAssets(
    fromSurveyId: string,
    toSurveyId: string,
    copiedAt: string,
  ): Promise<ReadonlyMap<string, string>>;
}

export type AppendOutcome = "stored" | "exists";

/** The provider cannot hold this response's answers (S7). Carries lengths only, never content. */
export class ResponseTooLargeError extends Error {
  constructor(
    readonly length: number,
    readonly max: number,
  ) {
    super(`The answers are ${String(length)} characters; the store holds at most ${String(max)}.`);
    this.name = "ResponseTooLargeError";
  }
}

export interface ResultStore {
  /**
   * Stores the response unless one with this id (case-insensitive) exists for the survey.
   * - absent: stores `{ id lower-case, submittedAt, data (a copy), clientId?, respondentIp?, partial:
   *   false }`, then, when `clientId` is given, writes or overwrites that client's marker as complete;
   *   -> "stored".
   * - present: the stored response is not changed; when `clientId` is given the client's marker is
   *   (re)written as complete (repairs a marker lost to a failure after the row); -> "exists".
   * Rejects (nothing written) when `id` is not a GUID. azure-legacy rejects with ResponseTooLargeError
   * (nothing written) when JSON.stringify(data) is longer than 32,768 UTF-16 code units.
   */
  appendResponse(survey: SurveyRecord, response: NewResponse): Promise<AppendOutcome>;
  /** Whether the survey has a response with this id (case-insensitive); false for a non-GUID id. */
  hasResponse(survey: SurveyRecord, id: string): Promise<boolean>;
  /** Every stored response (fixture rows included), submittedAt ascending, then id ascending. */
  listResponses(survey: SurveyRecord): Promise<SurveyResponse[]>;
  /** count = number of stored responses (no merging by client); first/last submittedAt; 0/null/null. */
  stats(survey: SurveyRecord): Promise<ResultStatsRecord>;
  /** The client's marker; client ids match exactly (case-sensitive). */
  completion(survey: SurveyRecord, clientId: string): Promise<CompletionState>;
  /**
   * One page of the survey's stored responses (fixture rows included) in submission order:
   * submittedAt ascending (as instants), then id ascending (code-point order of lower-case ids),
   * strictly after `after`. Rows of one client are not merged (R1). An unknown survey or one
   * without responses gives `{ items: [], next: null }`.
   */
  listResponsePage(survey: SurveyRecord, query: ResponsePageQuery): Promise<ResponsePage>;
  /**
   * Deletes every stored response of the survey (fixture rows included) and every completion marker,
   * so `completion` answers "none" afterwards. The survey record, saved views and the private-question
   * list stay. A survey without responses is fine (resolves). A response appended right afterwards is
   * stored normally (azure: the tables are kept, never dropped).
   */
  deleteAll(survey: SurveyRecord): Promise<void>;
}

export interface ViewStore {
  /**
   * The user's saved state of this view of the survey. When the user has none and has not reset
   * it since, the survey's legacy per-survey state as stored (R4): azure-legacy blob
   * `surveyresultsummarystate/{surveyId}` (summary) or `surveyresulttablestate/{surveyId}`
   * (table); memory the seed's `legacyViews`. null when there is neither, after a reset, for a
   * stored value that is not a JSON object, and for a non-GUID survey or user id. Ids match
   * case-insensitively.
   */
  getView(surveyId: string, userId: string, view: ViewName): Promise<ViewState | null>;
  /**
   * Stores a copy of `state` for this user, replacing an earlier state or a reset marker. Rejects
   * (nothing written) for a non-GUID survey or user id; does not check that either exists and does
   * not touch the survey record.
   */
  saveView(surveyId: string, userId: string, view: ViewName, state: ViewState): Promise<void>;
  /**
   * Deletes the user's state and leaves a reset marker, so `getView` answers null even where a
   * legacy state exists, until the next save. Idempotent (a reset without a saved state is fine).
   * Rejects for a non-GUID survey or user id, like `saveView`.
   */
  resetView(surveyId: string, userId: string, view: ViewName): Promise<void>;
  /**
   * The names of the survey's questions hidden from public results (R1), in stored order, no
   * duplicates; [] when none are stored, for an unknown survey and for a non-GUID id. Ids match
   * case-insensitively. azure-legacy: blob `surveyresultpermissions/{surveyId}` read with the legacy
   * defaults (`privateQuestionsFromLegacy`); no blob is []. It fails closed: a blob that is empty or
   * not a JSON array (a save between its create and its append, or one that failed half way) is
   * read once more, then rejects with a LegacyStoreError (operation name and codes only), so callers
   * never take an unreadable list for "every question public". memory: the seed's
   * `privateResultQuestions`, then saves; it never rejects for this.
   */
  getPrivateQuestions(surveyId: string): Promise<string[]>;
  /**
   * Replaces the list (`[]` makes every question public). Rejects (nothing written) for a non-GUID
   * id; does not check that the survey exists and does not touch the survey record. Deleted with the
   * survey, not copied by a clone, kept by `ResultStore.deleteAll`.
   */
  savePrivateQuestions(surveyId: string, names: readonly string[]): Promise<void>;
}

export interface SurveyStore {
  /** null when no survey has this id. */
  getSurvey(id: string): Promise<SurveyRecord | null>;
  /** Archived included. Ordered by updatedAt descending, then id ascending. */
  listSurveys(owner: SurveyOwner): Promise<SurveyRecord[]>;
  /**
   * The surveys of `listSurveys(owner)` whose archived flag equals `archived`, in the same order,
   * after `after` (updatedAt older, or equal with a greater id), at most `limit` of them.
   */
  listSurveyPage(query: SurveyPageQuery): Promise<SurveyPage>;
  /**
   * Stores a new survey with the legacy defaults (published flag left empty, which reads as
   * published; archived false, every setting false) and, when given, its first definition. Returns the record as stored (read back), which
   * can differ from the input in timestamp precision (SQL `datetime`). Throws on a duplicate id.
   */
  createSurvey(survey: NewSurvey, definition?: SurveyDefinition): Promise<SurveyRecord>;
  /** The definition (`{}` when none) and its version; null when no survey has this id. */
  getDefinition(id: string): Promise<Versioned<SurveyDefinition> | null>;
  /** The theme (`{}` when none) and its version; null when no survey has this id. */
  getTheme(id: string): Promise<Versioned<SurveyTheme> | null>;
  /**
   * Stores the definition when the current version equals `ifVersion`: sets `updatedAt` = `savedAt`
   * and adds a history entry `{ new id, at: savedAt, userId }` with the definition as its snapshot.
   * The returned version is the one the next `getDefinition` returns.
   */
  saveDefinition(
    id: string,
    definition: SurveyDefinition,
    save: { readonly ifVersion: string; readonly userId: string; readonly savedAt: string },
  ): Promise<SaveOutcome>;
  /** As saveDefinition, without a history entry. */
  saveTheme(
    id: string,
    theme: SurveyTheme,
    save: { readonly ifVersion: string; readonly savedAt: string },
  ): Promise<SaveOutcome>;
  /** History, newest first, ties by id descending; an unknown survey gives an empty page. */
  listHistory(query: HistoryQuery): Promise<HistoryPage>;
  /** The definition stored with that entry; null when there is no such entry. */
  getHistorySnapshot(surveyId: string, entryId: string): Promise<SurveyDefinition | null>;
  /** Applies the changes in one write; returns the record as stored (read back); null when no survey has this id. */
  updateSurvey(id: string, changes: SurveyChanges): Promise<SurveyRecord | null>;
  /**
   * Creates `copy` (legacy defaults, as `createSurvey`) with the source's definition and theme.
   * Returns the stored copy; null when no survey has `sourceId`. Throws on a duplicate copy id.
   * `options.rewriteText` rewrites the stored definition and theme text for the copy (R11).
   * Saved views are not copied.
   */
  cloneSurvey(
    sourceId: string,
    copy: NewSurvey,
    options?: CloneOptions,
  ): Promise<SurveyRecord | null>;
  /**
   * Deletes the survey and everything stored for it, its responses, markers and every user's saved
   * views and reset markers and the private-question list included; false when no survey has this id. Files are the FileStore's: the service deletes them first (R10).
   */
  deleteSurvey(id: string): Promise<boolean>;
  /**
   * R12: every owner id of a personal survey, archived ones included: distinct, lower-case,
   * ascending. NULL owners, the all-zero GUID and values that are not GUIDs are left out.
   */
  listPersonalOwnerIds(): Promise<string[]>;
  /**
   * R11: the id of every survey of the owner, archived ones included, also rows `listSurveys`
   * skips because the domain cannot represent them (azure-legacy: a NULL `postid` or `resultid`).
   * Lower-case, ascending. A personal scope never holds a project's surveys. [] for a non-GUID id.
   * Erasure reads this, so it reaches every row `listPersonalOwnerIds` sees.
   */
  listSurveyIds(owner: SurveyOwner): Promise<string[]>;
}

export type AddMemberOutcome = "added" | "already-member" | "not-found";
export type RoleChangeOutcome = "changed" | "unchanged" | "last-admin" | "not-found";
export type RemovalOutcome = "removed" | "last-admin" | "not-found";

/** `external`: the users belong to another system and are never created here. `local`: the app owns them (self-hosted track). */
export type UserDirectoryKind = "external" | "local";

/**
 * Users (R5): the authority for sign-in, lookup by email, licence notices and erasure detection.
 * Ids are matched case-insensitively and returned lower-case.
 */
export interface UserDirectory {
  readonly kind: UserDirectoryKind;
  /** null for an unknown id or an id that is not a GUID (no lookup is made for it). */
  getUser(id: string): Promise<User | null>;
  /** Case-insensitive match on email. A blank email matches no user (a NULL legacy email is ""). */
  findUserByEmail(email: string): Promise<User | null>;
  /**
   * The user to sign in from the identity claims. An external directory returns `getUser(claims.sub)`
   * and never creates a user (null when it does not know the user); a local one may create one
   * (self-hosted track). The caller handles null (claims fallback) and `blocked`.
   */
  signInUser(claims: IdentityClaims): Promise<User | null>;
  /**
   * The ids among `ids` this directory positively does not know (R12): lower-case, each once, in
   * the order of their first occurrence. Ids that are not GUIDs are never reported. Rejects on any
   * failure; a failure is never read as "missing".
   */
  missingUsers(ids: readonly string[]): Promise<string[]>;
}

export type InstanceRole = "admin" | "user";

/** `invited`: no password yet; `disabled`: may not sign in, and its sessions end. */
export type AccountStatus = "invited" | "active" | "disabled";

/** A local account (USER_DIRECTORY=local) as sign-in and the session check see it. */
export interface LocalAccount {
  /** The user as the directory shows it; `blocked` is true for a disabled account. */
  readonly user: User;
  readonly instanceRole: InstanceRole;
  readonly status: AccountStatus;
  /** null: no password set (an invited account, or one made for another sign-in method). */
  readonly passwordHash: string | null;
  readonly mustChangePassword: boolean;
  /** Raised by every password change and reset and by disabling: older sessions end (ADR 0026). */
  readonly sessionEpoch: number;
  /** ISO 8601 UTC; null before the first sign-in. */
  readonly lastSignInAt: string | null;
}

export interface NewLocalAccount {
  readonly id: string;
  /** Stored lower-case; unique. */
  readonly email: string;
  readonly displayName: string;
  readonly instanceRole: InstanceRole;
  readonly status: AccountStatus;
  readonly passwordHash: string | null;
  readonly mustChangePassword: boolean;
  readonly createdAt: string;
}

export type PasswordLinkPurpose = "setup" | "invitation" | "reset";

/**
 * The accounts of the local user directory: what password sign-in, the session check and the
 * set-password links need. Ids and emails match case-insensitively.
 */
export interface LocalAccountStore {
  countAccounts(): Promise<number>;
  /** Rejects (nothing stored) when the id or the email is in use. */
  createAccount(account: NewLocalAccount): Promise<LocalAccount>;
  /** null for an unknown or non-GUID id. */
  account(id: string): Promise<LocalAccount | null>;
  /** null for an unknown email. */
  accountByEmail(email: string): Promise<LocalAccount | null>;
  /**
   * Stores a new password hash and the must-change flag, makes an invited account active, and
   * raises the session epoch. Returns the new epoch; null when there is no such account.
   */
  setPassword(
    id: string,
    passwordHash: string,
    options: { readonly mustChange: boolean },
  ): Promise<number | null>;
  /** Notes a successful sign-in. */
  recordSignIn(id: string, at: string): Promise<void>;
  /** Stores a set-password link by the hash of its token. */
  createPasswordLink(link: {
    readonly tokenHash: string;
    readonly userId: string;
    readonly purpose: PasswordLinkPurpose;
    readonly createdAt: string;
    readonly expiresAt: string;
  }): Promise<void>;
  /**
   * Uses a link once: when it is unused and not expired at `at`, marks it used and returns its user
   * id; otherwise null. Two uses at the same time cannot both succeed.
   */
  usePasswordLink(tokenHash: string, at: string): Promise<string | null>;
}

/** What `eraseMember` decided and did (R11). */
export type MemberErasure =
  | { readonly kind: "not-member" } // no row of the user (or no such project): nothing written
  | { readonly kind: "last-member" } // no other visible member: nothing written; the caller deletes the project
  | { readonly kind: "promote"; readonly successorId: string } // rows deleted, successor made admin
  | { readonly kind: "remove" }; // rows deleted

/**
 * Projects, members and roles (R5): today's project operations of Directory, unchanged in names and
 * semantics. Member users are resolved from the provider's own user rows (R6).
 */
export interface ProjectStore {
  /**
   * Projects the user is a member of, ordered by project name ignoring case (lower-cased, code
   * point order), then project id. Works for a user the directory no longer knows (orphan rows).
   */
  listUserProjects(userId: string): Promise<ProjectMembership[]>;
  /** The user's membership of that project; null when not a member or no such project. */
  getUserProject(userId: string, projectId: string): Promise<ProjectMembership | null>;
  /**
   * The project's visible members (R11: rows whose user is missing are skipped), one entry per user,
   * ordered by display name ignoring case (lower-cased, code-point order), then user id (R16). [] for
   * an unknown project or a non-GUID id.
   */
  listMembers(projectId: string): Promise<ProjectMember[]>;
  /**
   * Stores the project and the creator's membership as admin, atomically (R4), and returns the
   * creator's membership as `getUserProject` would. Rejects (nothing stored) for a non-GUID id or an
   * id in use.
   */
  createProject(project: NewProject): Promise<ProjectMembership>;
  /** Sets the name (R5); `createdAt` and `ownerId` do not move. false: no such project (or non-GUID). */
  renameProject(
    projectId: string,
    name: string,
    options: { readonly now: string },
  ): Promise<boolean>;
  /**
   * Atomically (R9): moves every survey of the project, archived ones included, to the personal scope
   * of `receiverId` (`updatedAt` = `now`; id, creator, published, archived and settings unchanged),
   * deletes every membership and the project. Returns the moved survey ids in ascending code-point
   * order; null when no such project (nothing written). The caller chose the receiver (rules.ts).
   */
  deleteProject(
    projectId: string,
    options: { readonly receiverId: string; readonly now: string },
  ): Promise<string[] | null>;
  /**
   * Adds the user (R6). `already-member` when the user has any row in the project; `not-found` for
   * an unknown project. The caller passes an existing user (found by email).
   */
  addMember(
    projectId: string,
    userId: string,
    role: ProjectRole,
    options: { readonly now: string },
  ): Promise<AddMemberOutcome>;
  /** Sets the role of every row of the user, in place (R3), unless `decideRoleChange` refuses (R8). */
  setMemberRole(
    projectId: string,
    userId: string,
    role: ProjectRole,
    options: { readonly now: string },
  ): Promise<RoleChangeOutcome>;
  /** Deletes every row of the user (R7), unless `decideRemoval` refuses (R8). */
  removeMember(projectId: string, userId: string): Promise<RemovalOutcome>;
  /**
   * R11: atomically, decides with `decideMemberErasure` over the project's rows and writes the
   * decision. `promote`: deletes every row of the user (orphan or not) and sets every row of the
   * successor to `admin`; `remove`: deletes every row of the user; `not-member` and `last-member`
   * write nothing. An unknown project or a non-GUID id gives `not-member`, except that rows of the
   * user left under a project whose row is gone (azure-legacy only) are deleted and give `remove`.
   * Erasing the creator clears the project's owner (as `removeMember` does). Does not check whether
   * the user still exists.
   */
  eraseMember(
    projectId: string,
    userId: string,
    options: { readonly now: string },
  ): Promise<MemberErasure>;
  /** R12: every user id with a membership row (orphans included): distinct, lower-case, ascending. */
  listMemberUserIds(): Promise<string[]>;
  /**
   * R11: the id of every project in which the user has a membership row, whatever its role and
   * also when the project row is gone (azure-legacy): distinct, lower-case, ascending. [] for a
   * non-GUID id. Erasure reads this, so it reaches every row `listMemberUserIds` sees.
   */
  listUserProjectIds(userId: string): Promise<string[]>;
}

export interface ProviderSet {
  readonly name: string;
  readonly surveys: SurveyStore;
  /** R5: the user directory. */
  readonly users: UserDirectory;
  /** The local accounts behind `users` when USER_DIRECTORY=local; null for every other directory. */
  readonly accounts: LocalAccountStore | null;
  /** R5: projects, members and roles. */
  readonly projects: ProjectStore;
  readonly files: FileStore;
  readonly results: ResultStore;
  readonly views: ViewStore;
  /** Selected by `ACCOUNT_NOTICES`. */
  readonly notices: AccountNotices;
  /** Every check `ready()` runs, by name: `/readyz` lists them all when `ready()` itself fails. */
  readonly readinessNames: readonly ReadinessName[];
  /**
   * One entry per dependency check, run in parallel. A failed check may carry a safe category
   * (`reason`), never an error text.
   */
  ready(): Promise<readonly ReadinessCheck[]>;
  close(): Promise<void>;
}

export type ReadinessName =
  "sql" | "surveys-storage" | "results-storage" | "user-api" | "memory" | "database" | "files";

export interface ReadinessCheck {
  readonly name: ReadinessName;
  readonly ok: boolean;
  /** Why a check failed, for the log only: `timeout`, a driver or SDK code, an HTTP status. */
  readonly reason?: string;
}
