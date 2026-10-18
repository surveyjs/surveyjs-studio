import type { Handlers } from "../api.js";
import { requireUser } from "../auth/authenticate.js";
import type { ViewName, ViewState } from "../domain/types.js";
import { createViewsService, type ViewsServiceOptions } from "./service.js";

/** The saved results layouts. Requests reach them validated by the contract. */
export function createViewHandlers(options: ViewsServiceOptions): Handlers {
  const service = createViewsService(options);
  const target = (params: unknown) => params as { surveyId: string; view: ViewName };

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
  };
}
