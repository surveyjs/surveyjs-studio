/**
 * The records the migration tool writes, in the target's form: already normalised (ids lower-case,
 * times as ISO 8601 UTC), one per row or document of Studio's schema.
 */
import type {
  FileKind,
  LayoutKind,
  SurveyDefinition,
  SurveyFileRecord,
  SurveyRecord,
  SurveyResponse,
} from "../domain/types.js";

export interface SurveyRec {
  record: SurveyRecord;
  definition: SurveyDefinition;
  theme: Record<string, unknown>;
  privateQuestions: readonly string[];
}
export interface HistoryRec {
  surveyId: string;
  id: string;
  at: string;
  userId: string | null;
  snapshot: SurveyDefinition;
}
export interface ResponseRec {
  surveyId: string;
  response: SurveyResponse;
}
export interface MarkerRec {
  surveyId: string;
  clientId: string;
  partial: boolean;
}
export interface LayoutRec {
  surveyId: string;
  kind: LayoutKind;
  text: string;
}
export interface ViewRec {
  surveyId: string;
  userId: string;
  view: "summary" | "table";
  state: unknown | null;
  updatedAt: string;
}
export interface ProjectRec {
  id: string;
  name: string;
  creatorId: string | null;
  createdAt: string;
}
export interface MemberRec {
  projectId: string;
  userId: string;
  role: "admin" | "user";
  createdAt: string;
  updatedAt: string;
}
export interface PersonRec {
  id: string;
  email: string;
  displayName: string;
  siteBlocked: boolean;
  createdAt: string;
}
export interface KeyRec {
  userId: string;
  keyHash: string;
  lastFour: string;
  createdAt: string;
}
export interface FileRec {
  kind: FileKind;
  legacyName: string | null;
  record: SurveyFileRecord;
  content: Buffer;
} // legacyName null: Studio's own blob
export interface EventRec {
  id: string;
  surveyId: string;
  type: string;
  at: string;
  payload: string | null;
}
export interface DeletedRec {
  surveyId: string;
  responseId: string;
  deletedAt: string;
  response: string;
}
