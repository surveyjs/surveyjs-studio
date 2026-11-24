// The old API's route table: each action under two prefixes, matched in any letter case and with
// or without one trailing slash (the bridge's router options, app.ts). A path the table does not
// hold, or a method an action does not take, is forwarded to the old service (forward.ts).
import type {
  FastifyInstance,
  FastifyRequest,
  HTTPMethods,
  onRequestAsyncHookHandler,
  preHandlerAsyncHookHandler,
  RouteHandlerMethod,
} from "fastify";

export type Controller = "public" | "private";

export const PREFIXES: Record<Controller, readonly string[]> = {
  public: ["/public/Survey", "/public/v1/Survey"],
  private: ["/private/Surveys", "/private/v1/Surveys"],
};

/**
 * Registers an action: each of `names` (with a `/:id` form where the old route has one, e.g.
 * `["getSurveyPublicResults", "getSurveyPublicResults/:id"]`) under both prefixes of its controller,
 * `public/Survey` and `public/v1/Survey` or `private/Surveys` and `private/v1/Surveys`. The name
 * `""` is the prefix itself.
 */
export function oldRoute(
  app: FastifyInstance,
  methods: HTTPMethods[],
  names: string[],
  handler: RouteHandlerMethod,
  options: {
    controller?: Controller;
    /** The old action's name: the route's `config.action`, the metrics' `action` label. */
    action?: string;
    bodyLimit?: number;
    /** Run before the body is read, in order (e.g. to refuse a request without reading it). */
    onRequest?: onRequestAsyncHookHandler | onRequestAsyncHookHandler[];
    /** Runs once the body has been read, before the handler. */
    preHandler?: preHandlerAsyncHookHandler;
  } = {},
): void {
  const { bodyLimit, onRequest, preHandler } = options;
  for (const prefix of PREFIXES[options.controller ?? "public"]) {
    for (const name of names) {
      app.route({
        method: methods,
        url: name === "" ? prefix : `${prefix}/${name}`,
        handler,
        ...(options.action !== undefined && { config: { action: options.action } }),
        ...(bodyLimit !== undefined && { bodyLimit }),
        ...(onRequest !== undefined && { onRequest }),
        ...(preHandler !== undefined && { preHandler }),
      });
    }
  }
}

/**
 * A query parameter as the old API bound it: the name in any letter case, the first value when it
 * is repeated, `+` and percent escapes decoded. `undefined` when absent.
 */
export function queryValue(request: FastifyRequest, name: string): string | undefined {
  return queryValues(request, name)[0];
}

/** Every value of a query parameter, in order, its name in any letter case; `[]` when absent. */
export function queryValues(request: FastifyRequest, name: string): string[] {
  const url = request.raw.url ?? "";
  const start = url.indexOf("?");
  if (start < 0) return [];
  const wanted = name.toLowerCase();
  const values: string[] = [];
  for (const [key, value] of new URLSearchParams(url.slice(start + 1))) {
    if (key.toLowerCase() === wanted) values.push(value);
  }
  return values;
}
