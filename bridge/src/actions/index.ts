// The old API's actions the bridge answers itself. They share one body parser, scoped to them: the
// raw bytes, up to the old host's request limit, so each action reads its body as the old API did
// and answers its own refusals (415, validation 400) instead of the framework's.
import type { FastifyError, FastifyInstance } from "fastify";
import { sendEmpty } from "../answers.js";
import type { BridgeSettings } from "../settings.js";
import { SurveyCache } from "../survey-cache.js";
import { registerPostActions } from "./post.js";
import { registerSurveyActions } from "./survey.js";

/** The old host's request body limit (bytes); a larger body is an empty 413. */
export const MAX_BODY_BYTES = 30_000_000;

export function registerActions(app: FastifyInstance, settings: BridgeSettings): void {
  const cache = new SurveyCache(settings.cacheEntries);
  void app.register(async (actions) => {
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
    registerSurveyActions(actions, cache);
    registerPostActions(actions);
  });
}
