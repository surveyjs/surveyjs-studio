/**
 * The paths the web app's router answers (web/src/routes; the test checks the two agree). The
 * server answers its index.html with 200 on these and with 404 on any other path (ADR 0021).
 */
const SEGMENT = "[^/]+";

function route(path: string): RegExp {
  return new RegExp(`^${path}/?$`);
}

export const CLIENT_ROUTES: readonly RegExp[] = Object.freeze([
  /^\/$/,
  route("/projects"),
  route(`/surveys/${SEGMENT}/edit`),
  route(`/surveys/${SEGMENT}/history`),
  route(`/surveys/${SEGMENT}/results`),
  route(`/s/${SEGMENT}`),
  route(`/results/${SEGMENT}`),
  route("/sign-in"),
  route("/sign-in/refused"),
  route("/set-password"),
  route("/change-password"),
  route("/admin/users"),
]);

export function isClientRoute(pathname: string): boolean {
  return CLIENT_ROUTES.some((pattern) => pattern.test(pathname));
}
