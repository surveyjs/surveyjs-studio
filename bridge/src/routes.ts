// The old API's route table: each action under two prefixes, matched in any letter case and with
// or without one trailing slash (the bridge's router options, app.ts). A path the table does not
// hold, or a method an action does not take, is forwarded to the old service (forward.ts).
import type { FastifyInstance, FastifyRequest, HTTPMethods, RouteHandlerMethod } from "fastify";

export type Controller = "public" | "private";

const PREFIXES: Record<Controller, readonly string[]> = {
  public: ["/public/Survey", "/public/v1/Survey"],
  private: ["/private/Surveys", "/private/v1/Surveys"],
};

/**
 * Registers an action: each of `names` (with a `/:id` form where the old route has one, e.g.
 * `["getSurveyPublicResults", "getSurveyPublicResults/:id"]`) under both prefixes of its controller,
 * `public/Survey` and `public/v1/Survey` or `private/Surveys` and `private/v1/Surveys`.
 */
export function oldRoute(
  app: FastifyInstance,
  methods: HTTPMethods[],
  names: string[],
  handler: RouteHandlerMethod,
  options: { controller?: Controller; bodyLimit?: number } = {},
): void {
  const { bodyLimit } = options;
  for (const prefix of PREFIXES[options.controller ?? "public"]) {
    for (const name of names) {
      app.route({
        method: methods,
        url: `${prefix}/${name}`,
        handler,
        ...(bodyLimit !== undefined && { bodyLimit }),
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
