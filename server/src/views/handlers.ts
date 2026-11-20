import type { Handlers } from "../api.js";
import { requireUser } from "../auth/authenticate.js";
import type { LayoutKind, ViewName, ViewState } from "../domain/types.js";
import { createViewsService, type ViewsServiceOptions } from "./service.js";

/** The saved results layouts and the shared ones. Requests reach them validated by the contract. */
export function createViewHandlers(options: ViewsServiceOptions): Handlers {
  const service = createViewsService(options);
  const target = (params: unknown) => params as { surveyId: string; view: ViewName };
  const layout = (params: unknown) => params as { surveyId: string; kind: LayoutKind };

  return {
    getResultsView: (request) => {
      const { surveyId, view } = target(request.params);
      return service.get(requireUser(request), surveyId, view);
    },

    saveResultsView: async (request, reply) => {
      const { surveyId, view } = target(request.params);
      await service.save(requireUser(request), surveyId, view, request.body as ViewState);
      return reply.code(204).send();
    },

    resetResultsView: async (request, reply) => {
      const { surveyId, view } = target(request.params);
      await service.reset(requireUser(request), surveyId, view);
      return reply.code(204).send();
    },

    getSurveyLayout: (request) => {
      const { surveyId, kind } = layout(request.params);
      return service.getLayout(requireUser(request), surveyId, kind);
    },

    saveSurveyLayout: async (request, reply) => {
      const { surveyId, kind } = layout(request.params);
      const { text } = request.body as { text: string };
      await service.saveLayout(requireUser(request), surveyId, kind, text);
      return reply.code(204).send();
    },

    deleteSurveyLayout: async (request, reply) => {
      const { surveyId, kind } = layout(request.params);
      await service.deleteLayout(requireUser(request), surveyId, kind);
      return reply.code(204).send();
    },
  };
}
