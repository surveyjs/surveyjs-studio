// The old API's actions the bridge answers itself, registered from the mapping table (mapping.ts).
// They share one body parser, scoped to them: the raw bytes, up to the old host's request limit,
// so each action reads its body as the old API did and answers its own refusals (415, validation
// 400) instead of the framework's.
import type { FastifyError, FastifyInstance } from "fastify";
import { sendEmpty } from "../answers.js";
import type { ActionContext } from "../context.js";
import { keyGate, withKeyRule } from "../key.js";
import { ACTIONS } from "../mapping.js";
import { oldRoute } from "../routes.js";
import type { BridgeSettings } from "../settings.js";
import { SurveyCache } from "../survey-cache.js";

/** The old host's request body limit (bytes); a larger body is an empty 413. */
export const MAX_BODY_BYTES = 30_000_000;

export function registerActions(
  app: FastifyInstance,
  settings: BridgeSettings,
  deps: Pick<ActionContext, "studioFetch" | "forward" | "metrics">,
): void {
  const context: ActionContext = {
    settings,
    cache: new SurveyCache(settings.cacheEntries),
    ...deps,
  };
  void app.register(async (actions) => {
    actions.decorate("actionContext", context);
    actions.removeAllContentTypeParsers();
    actions.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: MAX_BODY_BYTES },
      (_request, body, done) => done(null, body),
    );
    // Body reading errors answer empty, as the old host did; anything else goes to the bridge's
    // own error handler.
    actions.setErrorHandler((error: FastifyError, _request, reply) => {
      if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") return sendEmpty(reply, 413);
      if (error.code?.startsWith("FST_ERR_CTP_") === true) return sendEmpty(reply, 400);
      throw error;
    });
    for (const entry of ACTIONS) {
      const bodyLimit =
        typeof entry.bodyLimit === "function" ? entry.bodyLimit(settings) : entry.bodyLimit;
      // The key gate first: a request it refuses runs no other hook and has no body read.
      const onRequest = [keyGate(entry.key), entry.onRequest].filter((hook) => hook !== undefined);
      oldRoute(
        actions,
        entry.methods,
        entry.paths,
        withKeyRule(entry.key, entry.handler, entry.keyFrom),
        {
          controller: entry.controller,
          action: entry.action,
          ...(bodyLimit !== undefined && { bodyLimit }),
          ...(onRequest.length > 0 && { onRequest }),
          ...(entry.preHandler !== undefined && { preHandler: entry.preHandler }),
        },
      );
    }
  });
}
