import type { HttpHandler } from "msw";
import { contentHandlers } from "./content";
import type { HandlerContext } from "./context";
import { sessionHandlers } from "./session";
import { surveyHandlers } from "./surveys";
import { catchAllHandlers, unsupportedHandlers } from "./unsupported";

export { http } from "./http";
export type { HandlerContext } from "./context";

/** The handlers of the operations the sandbox answers itself (Tasks 4 and 5 add their areas here). */
export function areaHandlers(context: HandlerContext): HttpHandler[] {
  return [...sessionHandlers(context), ...surveyHandlers(context), ...contentHandlers(context)];
}

/**
 * Every handler of the sandbox, in the order MSW tries them: the areas, then D7's unsupported
 * operations (`501 not-implemented`), then a catch-all for any other `/api/v1/*` request.
 */
export function createSandboxHandlers(context: HandlerContext): HttpHandler[] {
  return [...areaHandlers(context), ...unsupportedHandlers(), ...catchAllHandlers()];
}
