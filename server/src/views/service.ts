import type { RequestUser } from "../auth/authenticate.js";
import type { LayoutKind, ViewName, ViewState } from "../domain/types.js";
import { AppError } from "../errors.js";
import type { ProjectStore, SurveyStore, ViewStore } from "../providers/types.js";
import { createSurveyAccess } from "../surveys/access.js";

export interface ViewsService {
  /** The caller's layout; `404 view-not-found` when there is none. */
  get(user: RequestUser, surveyId: string, view: ViewName): Promise<ViewState>;
  save(user: RequestUser, surveyId: string, view: ViewName, state: ViewState): Promise<void>;
  reset(user: RequestUser, surveyId: string, view: ViewName): Promise<void>;
  /** The survey's shared layout text; `404 layout-not-found` when none is saved. */
  getLayout(user: RequestUser, surveyId: string, kind: LayoutKind): Promise<{ text: string }>;
  /** Replaces the shared layout; needs modify permission. */
  saveLayout(user: RequestUser, surveyId: string, kind: LayoutKind, text: string): Promise<void>;
  /** Deletes the shared layout (none saved is fine); needs modify permission. */
  deleteLayout(user: RequestUser, surveyId: string, kind: LayoutKind): Promise<void>;
}

export interface ViewsServiceOptions {
  readonly surveys: SurveyStore;
  readonly projects: ProjectStore;
  readonly views: ViewStore;
}

export const viewNotFound = (): AppError =>
  new AppError({ code: "view-not-found", status: 404, title: "View not found" });

export const layoutNotFound = (): AppError =>
  new AppError({ code: "layout-not-found", status: 404, title: "Layout not found" });

/**
 * Per-user results layouts and the surveys' shared layouts (ADR 0040 point 4). Anyone who can see
 * the survey may read, save and reset their own view and read the shared layouts; saving or
 * deleting a shared layout needs modify permission. The survey record is never touched.
 */
export function createViewsService(options: ViewsServiceOptions): ViewsService {
  const { views } = options;
  const access = createSurveyAccess({ surveys: options.surveys, projects: options.projects });

  return {
    async get(user, surveyId, view) {
      const { survey } = await access.visible(user, surveyId);
      const state = await views.getView(survey.id, user.id, view);
      if (state === null) throw viewNotFound();
      return state;
    },

    async save(user, surveyId, view, state) {
      const { survey } = await access.visible(user, surveyId);
      await views.saveView(survey.id, user.id, view, state);
    },

    async reset(user, surveyId, view) {
      const { survey } = await access.visible(user, surveyId);
      await views.resetView(survey.id, user.id, view);
    },

    async getLayout(user, surveyId, kind) {
      const { survey } = await access.visible(user, surveyId);
      const text = await views.getLayout(survey.id, kind);
      if (text === null) throw layoutNotFound();
      return { text };
    },

    async saveLayout(user, surveyId, kind, text) {
      const { survey } = await access.modifiable(user, surveyId);
      await views.saveLayout(survey.id, kind, text);
    },

    async deleteLayout(user, surveyId, kind) {
      const { survey } = await access.modifiable(user, surveyId);
      await views.deleteLayout(survey.id, kind);
    },
  };
}
