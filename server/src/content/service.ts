import type { components } from "@surveyjs-studio/contract";
import type { RequestUser } from "../auth/authenticate.js";
import type { Clock } from "../auth/session.js";
import type { SaveOutcome, SurveyDefinition, SurveyTheme, User } from "../domain/types.js";
import { AppError } from "../errors.js";
import { decodeHistoryCursor, encodeHistoryCursor } from "../paging/cursor.js";
import type { ProjectStore, SurveyStore, UserDirectory } from "../providers/types.js";
import { createSurveyAccess, notFound } from "../surveys/access.js";
import { ifMatchAllows } from "./etag.js";

type HistoryPage = components["schemas"]["HistoryPage"];

export interface ContentServiceOptions {
  readonly surveys: SurveyStore;
  readonly users: UserDirectory;
  readonly projects: ProjectStore;
  /** The clock for save times; default `Date.now`. */
  readonly now?: Clock;
}

/** A document and its version (the handler turns the version into the `ETag`). */
export interface VersionedContent<T> {
  readonly content: T;
  readonly version: string;
}

/** The `listSurveyHistory` query, after contract validation and defaults. */
export interface HistoryListQuery {
  readonly limit: number;
  readonly cursor?: string;
}

export interface ContentService {
  getDefinition(user: RequestUser, surveyId: string): Promise<VersionedContent<SurveyDefinition>>;
  /** Returns the new version. */
  saveDefinition(
    user: RequestUser,
    surveyId: string,
    definition: SurveyDefinition,
    ifMatch: string | undefined,
  ): Promise<string>;
  getTheme(user: RequestUser, surveyId: string): Promise<VersionedContent<SurveyTheme>>;
  /** Returns the new version. */
  saveTheme(
    user: RequestUser,
    surveyId: string,
    theme: SurveyTheme,
    ifMatch: string | undefined,
  ): Promise<string>;
  listHistory(user: RequestUser, surveyId: string, query: HistoryListQuery): Promise<HistoryPage>;
  /** The definition saved in one history entry. */
  getHistoryEntry(user: RequestUser, surveyId: string, entryId: string): Promise<SurveyDefinition>;
}

const editConflict = (): AppError =>
  new AppError({
    code: "edit-conflict",
    status: 412,
    title: "The survey was changed by someone else",
    detail: "Reload the survey to see the latest version.",
  });

const ifMatchRequired = (): AppError =>
  new AppError({
    code: "if-match-required",
    status: 428,
    title: "If-Match required",
    detail: "Send the ETag from your last read in If-Match.",
  });

/** Throws 428 when `If-Match` is absent or blank. */
function requireIfMatch(ifMatch: string | undefined): string {
  if (ifMatch === undefined || ifMatch.trim() === "") throw ifMatchRequired();
  return ifMatch;
}

/** The new version of a save, or the problem its outcome stands for. */
function savedVersion(outcome: SaveOutcome): string {
  if (outcome.kind === "saved") return outcome.version;
  throw outcome.kind === "conflict" ? editConflict() : notFound();
}

/** The rules of the survey documents: definition, theme and history. */
export function createContentService(options: ContentServiceOptions): ContentService {
  const { surveys, users, projects, now = Date.now } = options;
  const access = createSurveyAccess({ surveys, projects });

  return {
    async getDefinition(user, surveyId) {
      await access.visible(user, surveyId);
      const found = await surveys.getDefinition(surveyId);
      if (!found) throw notFound();
      return found;
    },

    async saveDefinition(user, surveyId, definition, ifMatch) {
      await access.modifiable(user, surveyId);
      const header = requireIfMatch(ifMatch);
      const current = await surveys.getDefinition(surveyId);
      if (!current) throw notFound();
      if (!ifMatchAllows(header, current.version)) throw editConflict();
      return savedVersion(
        await surveys.saveDefinition(surveyId, definition, {
          ifVersion: current.version,
          userId: user.id,
          savedAt: new Date(now()).toISOString(),
        }),
      );
    },

    async getTheme(user, surveyId) {
      await access.visible(user, surveyId);
      const found = await surveys.getTheme(surveyId);
      if (!found) throw notFound();
      return found;
    },

    async saveTheme(user, surveyId, theme, ifMatch) {
      await access.modifiable(user, surveyId);
      const header = requireIfMatch(ifMatch);
      const current = await surveys.getTheme(surveyId);
      if (!current) throw notFound();
      if (!ifMatchAllows(header, current.version)) throw editConflict();
      return savedVersion(
        await surveys.saveTheme(surveyId, theme, {
          ifVersion: current.version,
          savedAt: new Date(now()).toISOString(),
        }),
      );
    },

    async listHistory(user, surveyId, { limit, cursor }) {
      const { survey } = await access.visible(user, surveyId);
      const page = await surveys.listHistory({
        surveyId: survey.id,
        limit,
        ...(cursor !== undefined && { after: decodeHistoryCursor(cursor) }),
      });
      // One lookup per distinct user on the page; null when nobody has that id.
      const found = new Map<string, User | null>();
      for (const { userId } of page.items) {
        if (userId !== null && !found.has(userId)) {
          found.set(userId, await users.getUser(userId));
        }
      }
      return {
        items: page.items.map(({ id, at, userId }) => {
          const author = userId === null ? null : (found.get(userId) ?? null);
          return { id, at, user: author && { id: author.id, displayName: author.displayName } };
        }),
        nextCursor: page.next ? encodeHistoryCursor(page.next) : null,
      };
    },

    async getHistoryEntry(user, surveyId, entryId) {
      const { survey } = await access.visible(user, surveyId);
      const snapshot = await surveys.getHistorySnapshot(survey.id, entryId);
      if (!snapshot) throw notFound();
      return snapshot;
    },
  };
}
