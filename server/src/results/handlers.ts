import { Readable } from "node:stream";
import type { Handlers } from "../api.js";
import { requireUser } from "../auth/authenticate.js";
import { contentDisposition } from "../files/file-type.js";
import { negotiateExportFormat, notAcceptable, type ExportFormat } from "./export-format.js";
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

    listResults: (request) => {
      const { surveyId } = request.params as { surveyId: string };
      const query = request.query as { limit: number; cursor?: string };
      return service.list(requireUser(request), surveyId, {
        limit: query.limit,
        ...(query.cursor !== undefined && { cursor: query.cursor }),
      });
    },

    getResultStats: (request) => {
      const { surveyId } = request.params as { surveyId: string };
      return service.stats(requireUser(request), surveyId);
    },

    exportResults: async (request, reply) => {
      const { surveyId } = request.params as { surveyId: string };
      const { format } = request.query as { format?: ExportFormat };
      const user = requireUser(request);
      const chosen = negotiateExportFormat(format, request.headers.accept);
      if (chosen === null) throw notAcceptable();
      const file = await service.exportResults(user, surveyId, chosen);
      return reply
        .header("content-type", file.contentType)
        .header(
          "content-disposition",
          contentDisposition({ contentType: "application/octet-stream", name: file.fileName }),
        )
        .header("cache-control", "no-store")
        .header("x-content-type-options", "nosniff")
        .send(Readable.from(file.body, { objectMode: false }));
    },

    deleteResults: async (request, reply) => {
      const { surveyId } = request.params as { surveyId: string };
      await service.deleteResults(requireUser(request), surveyId);
      return reply.code(204).send();
    },

    getPublicResults: (request, reply) => {
      const { surveyId } = request.params as { surveyId: string };
      const query = request.query as { limit: number; cursor?: string };
      void reply.header("cache-control", "no-store");
      return service.publicPage(surveyId, {
        limit: query.limit,
        ...(query.cursor !== undefined && { cursor: query.cursor }),
      });
    },
  };
}
