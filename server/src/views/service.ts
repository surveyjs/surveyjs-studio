import type { RequestUser } from "../auth/authenticate.js";
import type { ViewName, ViewState } from "../domain/types.js";
import { AppError } from "../errors.js";
import type { ProjectStore, SurveyStore, ViewStore } from "../providers/types.js";
import { createSurveyAccess } from "../surveys/access.js";

export interface ViewsService {
  /** The caller's layout; `404 view-not-found` when there is none. */
  get(user: RequestUser, surveyId: string, view: ViewName): Promise<ViewState>;
  save(user: RequestUser, surveyId: string, view: ViewName, state: ViewState): Promise<void>;
  reset(user: RequestUser, surveyId: string, view: ViewName): Promise<void>;
}

export interface ViewsServiceOptions {
  readonly surveys: SurveyStore;
  readonly projects: ProjectStore;
  readonly views: ViewStore;
}

export const viewNotFound = (): AppError =>
  new AppError({ code: "view-not-found", status: 404, title: "View not found" });

/**
 * Per-user results layouts. Anyone who can see the survey may read, save and reset their own;
 * the survey record is never touched.
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
  };
}
