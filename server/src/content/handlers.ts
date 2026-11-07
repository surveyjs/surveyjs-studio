import type { Handlers } from "../api.js";
import { requireUser } from "../auth/authenticate.js";
import type { SurveyDefinition, SurveyTheme } from "../domain/types.js";
import { formatEtag } from "./etag.js";
import {
  createContentService,
  type ContentServiceOptions,
  type HistoryListQuery,
} from "./service.js";

const surveyIdOf = (params: unknown): string => (params as { surveyId: string }).surveyId;

/**
 * A compressing proxy rewrites the ETag of a response it compresses (Caddy's `encode`: `"v"` becomes
 * `"v-zstd"`), and the rewritten tag never matches on save. `no-transform` (RFC 9111) keeps the
 * read as the server sent it.
 */
const NO_TRANSFORM = "no-transform";

const ifMatchOf = (headers: Record<string, unknown>): string | undefined => {
  const value = headers["if-match"];
  return typeof value === "string" ? value : undefined;
};

/** The survey document operations: definition, theme and history. */
export function createContentHandlers(options: ContentServiceOptions): Handlers {
  const service = createContentService(options);

  return {
    getSurveyDefinition: async (request, reply) => {
      const { content, version } = await service.getDefinition(
        requireUser(request),
        surveyIdOf(request.params),
      );
      return reply
        .header("etag", formatEtag(version))
        .header("cache-control", NO_TRANSFORM)
        .send(content);
    },

    saveSurveyDefinition: async (request, reply) => {
      const version = await service.saveDefinition(
        requireUser(request),
        surveyIdOf(request.params),
        request.body as SurveyDefinition,
        ifMatchOf(request.headers),
      );
      return reply.code(204).header("etag", formatEtag(version)).send();
    },

    getSurveyTheme: async (request, reply) => {
      const { content, version } = await service.getTheme(
        requireUser(request),
        surveyIdOf(request.params),
      );
      return reply
        .header("etag", formatEtag(version))
        .header("cache-control", NO_TRANSFORM)
        .send(content);
    },

    saveSurveyTheme: async (request, reply) => {
      const version = await service.saveTheme(
        requireUser(request),
        surveyIdOf(request.params),
        request.body as SurveyTheme,
        ifMatchOf(request.headers),
      );
      return reply.code(204).header("etag", formatEtag(version)).send();
    },

    listSurveyHistory: (request) =>
      service.listHistory(
        requireUser(request),
        surveyIdOf(request.params),
        request.query as HistoryListQuery,
      ),

    getSurveyHistoryEntry: (request) => {
      const { surveyId, entryId } = request.params as { surveyId: string; entryId: string };
      return service.getHistoryEntry(requireUser(request), surveyId, entryId);
    },
  };
}
