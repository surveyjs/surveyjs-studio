// What the old API's actions share within one bridge: its settings, the `getSurvey` cache, the way
// to Studio and the way to the old service. Set on the actions' Fastify context (actions/index.ts),
// so the handlers of the mapping table (mapping.ts) read it from the request.
import type { FastifyReply, FastifyRequest } from "fastify";
import type { BridgeSettings } from "./settings.js";
import type { SurveyCache } from "./survey-cache.js";

export interface ActionContext {
  readonly settings: BridgeSettings;
  readonly cache: SurveyCache;
  /** How the bridge calls Studio (tests replace it). */
  readonly studioFetch: (request: Request) => Promise<Response>;
  /**
   * Hands the request to the old service unchanged and answers with its answer. The request's
   * body must not have been read: only for methods without a body (`GET`).
   */
  forward(request: FastifyRequest, reply: FastifyReply): void;
}

declare module "fastify" {
  interface FastifyInstance {
    /** Set on the actions' context only. */
    readonly actionContext: ActionContext;
  }
}

export function contextOf(request: FastifyRequest): ActionContext {
  return request.server.actionContext;
}
