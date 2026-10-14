import type { ProjectMembership, SurveyOwner, SurveyRecord, User } from "../domain/types.js";

export interface SurveyStore {
  /** null when no survey has this id. */
  getSurvey(id: string): Promise<SurveyRecord | null>;
  /** Archived included. Ordered by updatedAt descending, then id ascending. */
  listSurveys(owner: SurveyOwner): Promise<SurveyRecord[]>;
}

export interface Directory {
  getUser(id: string): Promise<User | null>;
  /** Case-insensitive match on email. */
  findUserByEmail(email: string): Promise<User | null>;
  /** Projects the user is a member of, ordered by project name, then project id. */
  listUserProjects(userId: string): Promise<ProjectMembership[]>;
}

export interface ProviderSet {
  readonly name: string;
  readonly surveys: SurveyStore;
  readonly directory: Directory;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}
