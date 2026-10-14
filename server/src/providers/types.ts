import type { ProjectMembership, SurveyOwner, SurveyRecord, User } from "../domain/types.js";
import type { AccountNotices } from "../notices/account-notices.js";

export interface SurveyStore {
  /** null when no survey has this id. */
  getSurvey(id: string): Promise<SurveyRecord | null>;
  /** Archived included. Ordered by updatedAt descending, then id ascending. */
  listSurveys(owner: SurveyOwner): Promise<SurveyRecord[]>;
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
