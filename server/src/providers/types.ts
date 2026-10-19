import type {
  HistoryEntryRecord,
  NewSurvey,
  ProjectMembership,
  SurveyChanges,
  SurveyDefinition,
  SurveyOwner,
  SurveyRecord,
  SaveOutcome,
  SurveyTheme,
  User,
  Versioned,
} from "../domain/types.js";
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
   * Stores a new survey with the legacy defaults (published false, archived false, every setting
   * false) and, when given, its first definition. Returns the record as stored (read back), which
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
   */
  cloneSurvey(sourceId: string, copy: NewSurvey): Promise<SurveyRecord | null>;
  /** Deletes the survey and everything stored for it; false when no survey has this id. */
  deleteSurvey(id: string): Promise<boolean>;
}

export interface Directory {
  getUser(id: string): Promise<User | null>;
  /** Case-insensitive match on email. A blank email matches no user (a NULL legacy email is ""). */
  findUserByEmail(email: string): Promise<User | null>;
  /**
   * Projects the user is a member of, ordered by project name ignoring case (lower-cased, code
   * point order), then project id.
   */
  listUserProjects(userId: string): Promise<ProjectMembership[]>;
  /** The user's membership of that project; null when not a member or no such project. */
  getUserProject(userId: string, projectId: string): Promise<ProjectMembership | null>;
}

export interface ProviderSet {
  readonly name: string;
  readonly surveys: SurveyStore;
  readonly directory: Directory;
  /** Selected by `ACCOUNT_NOTICES`. */
  readonly notices: AccountNotices;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}
