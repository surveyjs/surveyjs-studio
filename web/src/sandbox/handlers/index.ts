import type { HttpHandler } from "msw";
import { contentHandlers } from "./content";
import type { HandlerContext } from "./context";
import { fileHandlers } from "./files";
import { memberHandlers } from "./members";
import { projectHandlers } from "./projects";
import { publicHandlers } from "./public";
import { resultsHandlers } from "./results";
import { sessionHandlers } from "./session";
import { surveyHandlers } from "./surveys";
import { viewHandlers } from "./views";
import { catchAllHandlers, unsupportedHandlers } from "./unsupported";

export { http } from "./http";
export type { HandlerContext } from "./context";

/** The handlers of the operations the sandbox answers itself. */
export function areaHandlers(context: HandlerContext): HttpHandler[] {
  return [
    ...sessionHandlers(context),
    ...surveyHandlers(context),
    ...contentHandlers(context),
    ...fileHandlers(context),
    ...publicHandlers(context),
    ...resultsHandlers(context),
    ...viewHandlers(context),
    ...projectHandlers(context),
    ...memberHandlers(context),
  ];
}

/**
 * Every handler of the sandbox, in the order MSW tries them: the areas, then D7's unsupported
 * operations (`501 not-implemented`), then a catch-all for any other `/api/v1/*` request.
 */
export function createSandboxHandlers(context: HandlerContext): HttpHandler[] {
  return [...areaHandlers(context), ...unsupportedHandlers(), ...catchAllHandlers()];
}
