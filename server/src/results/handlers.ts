import { Readable } from "node:stream";
import type { Handlers } from "../api.js";
import { requireUser } from "../auth/authenticate.js";
import { formatEtag, ifNoneMatchHits } from "../content/etag.js";
import type { LayoutKind } from "../domain/types.js";
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
      const body = request.body as {
        data: Record<string, unknown>;
        clientId?: string;
        partial?: boolean;
      };
      const key = request.headers["idempotency-key"];
      const stored = await service.submit(surveyId, {
        data: body.data,
        ...(body.clientId !== undefined && { clientId: body.clientId }),
        ...(body.partial === true && { partial: true }),
        ...(typeof key === "string" && { idempotencyKey: key }),
        ip: request.ip,
      });
      return reply.code(201).send(stored);
    },

    submitResponseByPostId: async (request, reply) => {
      const { postId } = request.params as { postId: string };
      const body = request.body as {
        data: Record<string, unknown>;
        clientId?: string;
        partial?: boolean;
      };
      const key = request.headers["idempotency-key"];
      const stored = await service.submitByPostId(postId, {
        data: body.data,
        ...(body.clientId !== undefined && { clientId: body.clientId }),
        ...(body.partial === true && { partial: true }),
        ...(typeof key === "string" && { idempotencyKey: key }),
        ip: request.ip,
      });
      return reply.code(201).send(stored);
    },

    getPublicDefinition: async (request, reply) => {
      const { surveyId } = request.params as { surveyId: string };
      const { content, version } = await service.getPublicDefinition(surveyId);
      const etag = formatEtag(version);
      void reply.header("etag", etag).header("cache-control", "no-cache");
      const match = request.headers["if-none-match"];
      if (typeof match === "string" && ifNoneMatchHits(match, version)) {
        return reply.code(304).send();
      }
      return reply.send(content);
    },

    getRespondentState: (request) => {
      const { surveyId, clientId } = request.params as { surveyId: string; clientId: string };
      return service.respondentState({ surveyId }, clientId);
    },

    getRespondentStateByResultId: (request) => {
      const { resultId, clientId } = request.params as { resultId: string; clientId: string };
      return service.respondentState({ resultId }, clientId);
    },

    getQuestionSummary: (request) => {
      const { resultId, name } = request.params as { resultId: string; name: string };
      return service.questionSummary(resultId, name);
    },

    listResults: (request) => {
      const { surveyId } = request.params as { surveyId: string };
      const query = request.query as {
        limit: number;
        cursor?: string;
        from?: string;
        till?: string;
      };
      return service.list(requireUser(request), surveyId, {
        limit: query.limit,
        ...(query.cursor !== undefined && { cursor: query.cursor }),
        ...(query.from !== undefined && { from: query.from }),
        ...(query.till !== undefined && { till: query.till }),
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

    deleteResponse: async (request, reply) => {
      const { surveyId, responseId } = request.params as { surveyId: string; responseId: string };
      await service.deleteResponse(requireUser(request), surveyId, responseId);
      return reply.code(204).send();
    },

    getPublicResults: (request, reply) => {
      const { surveyId } = request.params as { surveyId: string };
      const query = request.query as {
        limit: number;
        cursor?: string;
        from?: string;
        till?: string;
      };
      void reply.header("cache-control", "no-store");
      return service.publicPage(surveyId, {
        limit: query.limit,
        ...(query.cursor !== undefined && { cursor: query.cursor }),
        ...(query.from !== undefined && { from: query.from }),
        ...(query.till !== undefined && { till: query.till }),
      });
    },

    getPublicLayout: (request, reply) => {
      const { surveyId, kind } = request.params as { surveyId: string; kind: LayoutKind };
      void reply.header("cache-control", "no-store");
      return service.publicLayout(surveyId, kind);
    },
  };
}
