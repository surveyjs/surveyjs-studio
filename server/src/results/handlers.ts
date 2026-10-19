import type { Handlers } from "../api.js";
import { requireUser } from "../auth/authenticate.js";
import { createResultsService, type ResultsServiceOptions } from "./service.js";

/** The public run operations and the response count. Requests reach them validated by the contract. */
export function createResultHandlers(options: ResultsServiceOptions): Handlers {
  const service = createResultsService(options);

  return {
    getPublishedSurvey: (request) => {
      const { surveyId } = request.params as { surveyId: string };
      const { clientId } = request.query as { clientId?: string };
      return service.getPublished(surveyId, clientId);
    },

    submitResponse: async (request, reply) => {
      const { surveyId } = request.params as { surveyId: string };
      const body = request.body as { data: Record<string, unknown>; clientId?: string };
      const key = request.headers["idempotency-key"];
      const stored = await service.submit(surveyId, {
        data: body.data,
        ...(body.clientId !== undefined && { clientId: body.clientId }),
        ...(typeof key === "string" && { idempotencyKey: key }),
        ip: request.ip,
      });
      return reply.code(201).send(stored);
    },

    getResultStats: (request) => {
      const { surveyId } = request.params as { surveyId: string };
      return service.stats(requireUser(request), surveyId);
    },
  };
}
