import type { Readable } from "node:stream";
import type {
  CompletionState,
  FileKind,
  HistoryEntryRecord,
  LayoutKind,
  NewProject,
  NewResponse,
  NewSurvey,
  ProjectMember,
  ProjectMembership,
  ProjectRecord,
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
import type { ExternalMethod } from "../config.js";
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
  /** Leave out responses whose run has no complete row (ADR 0038). */
  readonly completedOnly?: boolean;
  /**
   * ISO 8601. Only responses placed strictly after this time (a run's place is its first row's
   * `submittedAt`, ADR 0038). Applied before `limit`; a cursor before it reads as it.
   */
  readonly from?: string;
  /** ISO 8601. Only responses placed strictly before this time, as `from`. */
  readonly till?: string;
}

export interface ResponsePage {
  /**
   * At most `limit` responses, in submission order. May be shorter than `limit` even when more
   * follow (legacy rows the domain cannot represent are skipped, never repeated).
   */
  readonly items: SurveyResponse[];
  /**
   * First-row position of the last response returned when more follow; null on the last page.
   * A response is a run of one client's rows read as one (ADR 0038).
   */
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
  /**
   * A file stored under the old service's name (ADR 0039 point 3): an editor image (`asset`) or a
   * respondent upload (`response`). Names match as stored, case included; null for an unknown
   * name and, without any lookup, for a name `isLegacyFileName` refuses. The bytes are as stored;
   * `file.name` is the legacy name and `file.contentType` the type of its extension
   * (`legacyContentType`), whatever the provider keeps. A provider that holds the file by name
   * only gives it the record of `legacyFileRecord`.
   *
   * An `asset` name is first looked up among the files of no survey (`saveUserFile`, by the
   * `legacyName` it gave): such a file has its stored record, with `file.name` the legacy name and
   * its stored type. Then among the old service's files.
   */
  getFileByLegacyName(kind: FileKind, name: string): Promise<StoredFileContent | null>;
  /**
   * Stores an editor file that belongs to no survey (`uploadLegacyFile`, ADR 0040 point 3) for its
   * owner (a GUID, any case; rejects otherwise): kind `asset`, `surveyId` null, a new random id
   * (`newUserFileId()`), and a new legacy name (`newLegacyFileName()`: a random lower-case GUID, as
   * the old service named uploads) by which `getFileByLegacyName("asset", legacyName)` finds it.
   * Neither names the owner or a survey: the name is public. Studio's own file store on every
   * provider, never the old service's. Such a file is no survey's: `getFile`, `deleteFile`,
   * `usage` and `deleteSurveyFiles` do not see it.
   */
  saveUserFile(ownerUserId: string, file: NewFile): Promise<StoredUserFile>;
  /** How many files `saveUserFile` stored for the owner (any id case); 0 for a non-GUID id. */
  countUserFiles(ownerUserId: string): Promise<number>;
  /**
   * Deletes every file `saveUserFile` stored for the owner (any id case) and returns how many; 0
   * for a non-GUID id.
   */
  deleteUserFiles(ownerUserId: string): Promise<number>;
}

/** What `FileStore.saveUserFile` stored: the record and the file's legacy name. */
export interface StoredUserFile {
  readonly file: StoredFileRecord;
  /** A lower-case GUID; `getFileByLegacyName("asset", legacyName)` reads the file. */
  readonly legacyName: string;
}

/** A file to store for a user (`FileStore.saveUserFile`). */
export interface NewFile {
  /** The uploaded name (R12). */
  readonly name: string;
  /** The detected type. */
  readonly contentType: string;
  /** ISO 8601 UTC. */
  readonly createdAt: string;
  readonly content: Buffer;
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
   *   response.partial === true && clientId given }` (a partial post without a client id is stored as
   *   complete: there is no run to fold it into), then, when `clientId` is given, writes or overwrites that client's
   *   marker (partial when the response is, else complete); -> "stored".
   * - present: the stored response is not changed; when `clientId` is given the client's marker is
   *   (re)written with the posted state (repairs a marker lost to a failure after the row); -> "exists".
   * Rejects (nothing written) when `id` is not a GUID. azure-legacy rejects with ResponseTooLargeError
   * (nothing written) when JSON.stringify(data) is longer than 32,768 UTF-16 code units.
   */
  appendResponse(survey: SurveyRecord, response: NewResponse): Promise<AppendOutcome>;
  /** Whether the survey has a response with this id (case-insensitive); false for a non-GUID id. */
  hasResponse(survey: SurveyRecord, id: string): Promise<boolean>;
  /** Every stored row (fixture rows included, raw: runs are not folded), submittedAt ascending, then id ascending. */
  listResponses(survey: SurveyRecord): Promise<SurveyResponse[]>;
  /**
   * count = number of complete rows (partial rows are not counted); first/last submittedAt of the
   * complete rows; 0/null/null.
   */
  stats(survey: SurveyRecord): Promise<ResultStatsRecord>;
  /** Whether any client's marker of the survey is partial (an open partial run may exist). */
  hasPartial(survey: SurveyRecord): Promise<boolean>;
  /** The client's marker; client ids match exactly (case-sensitive). */
  completion(survey: SurveyRecord, clientId: string): Promise<CompletionState>;
  /**
   * One page of the survey's responses (fixture rows included) in submission order. A response is
   * a run of one client's rows (ADR 0038) placed at its first row: submittedAt ascending (as
   * instants), then id ascending (code-point order of lower-case ids), strictly after `after`;
   * `completedOnly` leaves out runs without a complete row. An unknown survey or one without
   * responses gives `{ items: [], next: null }`.
   */
  listResponsePage(survey: SurveyRecord, query: ResponsePageQuery): Promise<ResponsePage>;
  /**
   * Deletes every stored response of the survey (fixture rows included) and every completion marker,
   * so `completion` answers "none" afterwards. The survey record, saved views and the private-question
   * list stay. A survey without responses is fine (resolves). A response appended right afterwards is
   * stored normally (azure: the tables are kept, never dropped).
   */
  deleteAll(survey: SurveyRecord): Promise<void>;
  /**
   * Deletes one response: the whole run (ADR 0038) holding the stored row `responseId`, which may
   * be any row of the run (ids compared case-insensitively; `runHolding`). Then the client's
   * marker is deleted, so `completion` answers "none", unless the client has a later run, whose
   * state the marker holds. Other responses, the survey record and respondent files stay. An
   * audit copy is kept as `deleteAll` keeps one: azure-legacy first copies each row to the old
   * service's table of deleted results, as its single delete did; memory and SQL keep none.
   * false (nothing changed) when no row of the survey has the id, a non-GUID id included.
   * azure-legacy deletes exactly the rows it folded into the run: a save stored meanwhile stays,
   * and so does the marker it wrote (the marker is deleted only if unchanged since it was read).
   */
  deleteResponse(survey: SurveyRecord, responseId: string): Promise<boolean>;
}

export interface ViewStore {
  /**
   * The user's saved state of this view of the survey. When the user has none and has not reset
   * it since, the survey's shared layout of the same kind (`getLayout`, ADR 0040 point 4) parsed
   * as JSON. null when there is neither, after a reset, for a stored value that is not a JSON
   * object (azure-legacy logs a warning with the ids), and for a non-GUID survey or user id. Ids
   * match case-insensitively.
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
   * The survey's shared layout of this kind (ADR 0040 point 4), the text exactly as saved; null
   * when none is saved, for an empty stored text and for a non-GUID id. Ids match
   * case-insensitively. azure-legacy: the old service's per-survey layout itself, so the old site
   * and Studio read one copy; memory: the seed's `layouts`, then saves.
   */
  getLayout(surveyId: string, kind: LayoutKind): Promise<string | null>;
  /**
   * Stores `text` as the survey's layout of this kind, replacing the previous one. No history, no
   * audit entry, no change of the survey record (ADR 0015 R7). Rejects (nothing written) for a
   * non-GUID id; does not check that the survey exists. Deleted with the survey, not copied by a
   * clone.
   */
  saveLayout(surveyId: string, kind: LayoutKind, text: string): Promise<void>;
  /** Deletes the layout of this kind; idempotent. Rejects for a non-GUID id, like `saveLayout`. */
  deleteLayout(surveyId: string, kind: LayoutKind): Promise<void>;
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
  /**
   * The survey with this post ID, result ID or legacy publish ID (GUIDs, compared
   * case-insensitively); null when none has it or the value is not a GUID. Archived surveys are
   * found.
   */
  findSurveyByKey(
    key:
      | { readonly postId: string }
      | { readonly resultId: string }
      | { readonly legacyPublishId: string },
  ): Promise<SurveyRecord | null>;
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
  /** The site blocks the account (set at sign-in); `user.blocked` is true for it too. */
  readonly siteBlocked: boolean;
  /** ISO 8601 UTC; when the licence ends, as the site reported it. */
  readonly licenceExpiresAt: string | null;
  /** Raised by every password change and reset and by disabling: older sessions end (ADR 0026). */
  readonly sessionEpoch: number;
  /** ISO 8601 UTC; null before the first sign-in. */
  readonly lastSignInAt: string | null;
  /** ISO 8601 UTC. */
  readonly createdAt: string;
}

/** What an instance admin may change of an account (updateUser). */
export interface AccountChange {
  readonly instanceRole?: InstanceRole;
  readonly status?: "active" | "disabled";
}

/**
 * `allowLastInstanceAdmin`: the change may take the last active admin away. Only the account-deleted
 * webhook passes it, to disable the last admin before it becomes a placeholder (`tombstoneAccount`).
 */
export interface LastInstanceAdminOptions {
  readonly allowLastInstanceAdmin?: boolean;
}

export type AccountUpdate =
  | { readonly outcome: "updated"; readonly account: LocalAccount }
  | { readonly outcome: "not-found" }
  | { readonly outcome: "last-instance-admin" };

export interface NewLocalAccount {
  readonly id: string;
  /** Stored lower-case; unique. */
  readonly email: string;
  readonly displayName: string;
  readonly instanceRole: InstanceRole;
  readonly status: AccountStatus;
  readonly passwordHash: string | null;
  readonly mustChangePassword: boolean;
  /** Default false. */
  readonly siteBlocked?: boolean;
  /** ISO 8601 UTC; default null. */
  readonly licenceExpiresAt?: string | null;
  readonly createdAt: string;
}

/** What the site tells at a sign-in about the account (refreshFromSignIn). */
export interface SignInRefresh {
  /** Lower-case. */
  readonly email: string;
  readonly displayName: string;
  readonly siteBlocked: boolean;
  readonly licenceExpiresAt: string | null;
}

export type SignInRefreshResult =
  | { readonly outcome: "updated"; readonly account: LocalAccount }
  | { readonly outcome: "email-taken"; readonly account: LocalAccount }
  | { readonly outcome: "not-found" };

export type PasswordLinkPurpose = "setup" | "invitation" | "reset";

/** A set-password link as the store keeps it (only a hash of the token). */
export interface NewPasswordLink {
  readonly tokenHash: string;
  readonly purpose: PasswordLinkPurpose;
  /** ISO 8601 UTC. */
  readonly createdAt: string;
  /** ISO 8601 UTC. */
  readonly expiresAt: string;
}

/** An account's unused set-password link that has not expired. */
export interface PendingPasswordLink {
  readonly purpose: PasswordLinkPurpose;
  /** ISO 8601 UTC. */
  readonly expiresAt: string;
}

/**
 * The accounts of the local user directory: what password sign-in, the session check and the
 * set-password links need. Ids and emails match case-insensitively.
 */
export interface LocalAccountStore {
  countAccounts(): Promise<number>;
  /** Accounts with the instance role `admin` and the status `active`. */
  countActiveAdmins(): Promise<number>;
  /**
   * Accounts with the instance role `admin`, in any status (a deleted admin's placeholder
   * included): 0 only on an instance that never had an admin (ADR 0043).
   */
  countAdmins(): Promise<number>;
  /**
   * Rejects (nothing stored) when the id or the email is in use. With `link`, stores the account's
   * set-password link in the same transaction: both are stored, or neither.
   */
  createAccount(
    account: NewLocalAccount,
    options?: { readonly link?: NewPasswordLink },
  ): Promise<LocalAccount>;
  /** null for an unknown or non-GUID id. */
  account(id: string): Promise<LocalAccount | null>;
  /** null for an unknown email. */
  accountByEmail(email: string): Promise<LocalAccount | null>;
  /** Every account, ordered by email (lower-case, code-point order). */
  listAccounts(): Promise<LocalAccount[]>;
  /**
   * Changes the role and the status (`nextStatus`), atomically with the last-instance-admin rule
   * (`decideAccountChange`; two changes at once cannot both take the last admin away). Disabling
   * an account that was not disabled raises its session epoch. `allowLastInstanceAdmin` skips the
   * rule: only for the account-deleted webhook (ADR 0043), never for an instance admin's change.
   */
  updateAccount(
    id: string,
    change: AccountChange,
    options?: LastInstanceAdminOptions,
  ): Promise<AccountUpdate>;
  /**
   * Stores what the site told at a sign-in: the display name, the block and the licence date, and
   * the email (also in the account's `surveyjs` identity). An email another account holds is
   * `email-taken`: the old email stays, the rest is written. Status, role and password are not
   * changed.
   */
  refreshFromSignIn(id: string, change: SignInRefresh): Promise<SignInRefreshResult>;
  /** The account an external identity is linked to; null when none. */
  accountByIdentity(provider: ExternalMethod, subject: string): Promise<LocalAccount | null>;
  /** Links the identity to an account; `taken` when that (provider, subject) is linked already, to anyone. */
  linkIdentity(link: IdentityLink): Promise<"linked" | "taken">;
  /**
   * The account's linked identities, ordered by provider, then link time, then subject. [] for an
   * unknown or non-GUID id.
   */
  listIdentities(userId: string): Promise<IdentityLink[]>;
  /**
   * Unlinks one identity of the account and raises its session epoch, atomically (the account's
   * sessions end: one of them may come from that identity). Returns the new epoch; null when the
   * account has no such identity (nothing changes).
   */
  unlinkIdentity(userId: string, provider: ExternalMethod, subject: string): Promise<number | null>;
  /** Deletes the account with its links and identities, under the same rule. */
  deleteAccount(id: string): Promise<"deleted" | "not-found" | "last-instance-admin">;
  /**
   * Replaces the account's personal data with a placeholder, atomically (ADR 0043 point 2: the
   * last instance admin deleted on surveyjs.io): email `deleted-<id>@invalid`, display name
   * `Deleted account`, status `disabled`, no password, the site's block cleared, no licence date;
   * removes its identities and set-password links and raises the session epoch. The role is kept.
   * null for an unknown or non-GUID id.
   */
  tombstoneAccount(id: string): Promise<LocalAccount | null>;
  /**
   * An admin's reset, atomically: clears the password, unlinks every identity, raises the epoch,
   * marks the account's unused links used, and stores the new link (`invitation` for an invited
   * account, else `reset`). Returns the new epoch; null when there is no such account (nothing
   * stored).
   */
  resetPassword(
    id: string,
    link: { readonly tokenHash: string; readonly createdAt: string; readonly expiresAt: string },
  ): Promise<number | null>;
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
  /**
   * Each account's unused link that has not expired at `at`, by user id (lower-case); the one that
   * expires last when there are several.
   */
  pendingPasswordLinks(at: string): Promise<ReadonlyMap<string, PendingPasswordLink>>;
  /** Stores a set-password link by the hash of its token. */
  createPasswordLink(link: {
    readonly tokenHash: string;
    readonly userId: string;
    readonly purpose: PasswordLinkPurpose;
    readonly createdAt: string;
    readonly expiresAt: string;
  }): Promise<void>;
  /**
   * Uses a link once, atomically with setting the password: when it is unused and not expired at
   * `at`, marks it used and stores `passwordHash` as `setPassword` does (no must-change flag);
   * returns the user id and the new epoch. Otherwise null, and nothing changes. Two uses at the
   * same time cannot both succeed.
   */
  usePasswordLink(
    tokenHash: string,
    at: string,
    passwordHash: string,
  ): Promise<{ readonly userId: string; readonly epoch: number } | null>;
}

/** An account's identity at an external sign-in provider (self-hosted Step 8). */
export interface IdentityLink {
  readonly provider: ExternalMethod;
  /** The provider's stable id of the person. */
  readonly subject: string;
  readonly userId: string;
  /** Lower-case, as the provider gave it when the identity was linked. */
  readonly email: string | null;
  readonly emailVerified: boolean;
  /** ISO 8601 UTC. */
  readonly createdAt: string;
}

/** A member added by email before that person has an account (USER_DIRECTORY=local). */
export interface ProjectInvitation {
  readonly projectId: string;
  /** Stored lower-case. */
  readonly email: string;
  readonly role: ProjectRole;
  /** The user id of the member who invited. */
  readonly invitedBy: string;
  /** ISO 8601 UTC. */
  readonly createdAt: string;
}

/** Pending project invitations; every method lower-cases the email it is given. */
export interface InvitationStore {
  /** The project's invitations, ordered by email. */
  listInvitations(projectId: string): Promise<ProjectInvitation[]>;
  addInvitation(
    invitation: ProjectInvitation,
  ): Promise<"added" | "already-invited" | "project-not-found">;
  removeInvitation(projectId: string, email: string): Promise<"removed" | "not-found">;
  /** Whether any project has an invitation for the email. */
  hasInvitation(email: string): Promise<boolean>;
  /**
   * In one transaction: every invitation for the email becomes a membership of `userId` with its
   * role (skipped when the user is already a member), then is deleted. Returns how many
   * memberships it added.
   */
  claimInvitations(
    userId: string,
    email: string,
    options: { readonly now: string },
  ): Promise<number>;
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
   * Every project with a member, in project list order (an instance admin's view, S17). Member
   * counts and owners as `listUserProjects` gives them.
   */
  listProjects(): Promise<ProjectRecord[]>;
  /** The project, whoever asks (an instance admin); null when none, or for a non-GUID id. */
  getProject(projectId: string): Promise<ProjectRecord | null>;
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

/** An API token as stored: never the value, only its last four characters. */
export interface ApiTokenRecord {
  readonly id: string;
  readonly creatorId: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly lastFour: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  /** Null for a usable token; when it was revoked otherwise (it then does not authenticate). */
  readonly revokedAt: string | null;
}

export interface LegacyKeyMatch {
  readonly userId: string;
  readonly revoked: boolean;
}

/** API tokens and the per-user access keys that predate them. Values are stored only as hashes. */
export interface CredentialStore {
  createApiToken(
    token: Omit<ApiTokenRecord, "lastUsedAt" | "revokedAt">,
    hash: string,
  ): Promise<void>;
  /** By the hash of the value; revoked tokens too (with `revokedAt`). */
  findApiToken(hash: string): Promise<ApiTokenRecord | null>;
  /** By id (any letter case); revoked tokens too. Null for an unknown id or one that is not a GUID. */
  getApiToken(id: string): Promise<ApiTokenRecord | null>;
  /** The scope's tokens that are not revoked, newest first (`createdAt` descending, then `id`). */
  listApiTokens(
    scope: { readonly creatorId: string } | { readonly projectId: string },
  ): Promise<ApiTokenRecord[]>;
  /** False when the token is unknown or already revoked (the first revocation time stays). */
  revokeApiToken(id: string, at: string): Promise<boolean>;
  /**
   * Swaps the stored hash and last four of an unrevoked token. False when the token is unknown or
   * revoked, also when a concurrent change left it revoked. Two concurrent replaces both succeed,
   * one after the other: the last value wins and the earlier one no longer authenticates.
   */
  replaceApiTokenHash(id: string, hash: string, lastFour: string): Promise<boolean>;
  touchApiToken(id: string, at: string): Promise<void>;
  /** Revokes every unrevoked token the user created, project tokens too; returns how many. */
  revokeApiTokensOfCreator(userId: string, at: string): Promise<number>;
  /** Revokes every unrevoked token of the project; returns how many. */
  revokeApiTokensOfProject(projectId: string, at: string): Promise<number>;
  /** By the value, without regard to letter case. Null when no user has this key. */
  findLegacyKey(value: string): Promise<LegacyKeyMatch | null>;
  legacyKeyOf(
    userId: string,
  ): Promise<{ readonly lastFour: string; readonly revoked: boolean } | null>;
  /** False when the user has no key. */
  revokeLegacyKey(userId: string, at: string): Promise<boolean>;
  /**
   * Replaces the user's legacy key `expectedHash` (the one that signed the request): revokes it at
   * `at` and stores `newHash` and `lastFour` as the user's key, created at `at`. False when the user
   * has no such unrevoked key (it was revoked or replaced, also by a concurrent request that got
   * there first). Optional: the azure-legacy provider does not implement it.
   */
  replaceLegacyKey?(
    userId: string,
    expectedHash: string,
    newHash: string,
    lastFour: string,
    at: string,
  ): Promise<boolean>;
}

export interface ProviderSet {
  readonly name: string;
  readonly surveys: SurveyStore;
  /** R5: the user directory. */
  readonly users: UserDirectory;
  /** The local accounts behind `users` when USER_DIRECTORY=local; null for every other directory. */
  readonly accounts: LocalAccountStore | null;
  /** Pending project invitations: non-null exactly when `accounts` is. */
  readonly invitations: InvitationStore | null;
  /** R5: projects, members and roles. */
  readonly projects: ProjectStore;
  readonly files: FileStore;
  readonly results: ResultStore;
  readonly views: ViewStore;
  /** API tokens and legacy access keys. */
  readonly credentials: CredentialStore;
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
  "sql" | "surveys-storage" | "results-storage" | "memory" | "database" | "files";

export interface ReadinessCheck {
  readonly name: ReadinessName;
  readonly ok: boolean;
  /** Why a check failed, for the log only: `timeout`, a driver or SDK code, an HTTP status. */
  readonly reason?: string;
}
