// D7: what the demo does not offer answers `501 not-implemented`, as the server answers an operation
// it has not implemented (server/src/api.ts `notImplemented`).
import { http as mswHttp } from "msw";
import { notImplemented, guarded } from "./problems";

interface Unsupported {
  readonly id: string;
  readonly method: "get" | "post" | "put" | "patch" | "delete";
  readonly path: string;
}

const UNSUPPORTED: readonly Unsupported[] = [
  { id: "login", method: "get", path: "/auth/login" },
  { id: "loginCallback", method: "get", path: "/auth/callback" },
  { id: "passwordLogin", method: "post", path: "/auth/password/login" },
  { id: "setPasswordWithLink", method: "post", path: "/auth/password-link" },
  { id: "changeOwnPassword", method: "post", path: "/me/password" },
  { id: "listUsers", method: "get", path: "/admin/users" },
  { id: "createUser", method: "post", path: "/admin/users" },
  { id: "updateUser", method: "patch", path: "/admin/users/:userId" },
  { id: "deleteUser", method: "delete", path: "/admin/users/:userId" },
  { id: "createUserResetLink", method: "post", path: "/admin/users/:userId/reset-link" },
  { id: "exportResults", method: "get", path: "/surveys/:surveyId/results/export" },
  { id: "receiveAccountDeleted", method: "post", path: "/webhooks/account-deleted" },
];

/** The operation ids of the contract the demo does not support. */
export const UNSUPPORTED_OPERATIONS: readonly string[] = UNSUPPORTED.map((entry) => entry.id);

export function unsupportedHandlers() {
  return UNSUPPORTED.map(({ id, method, path }) =>
    mswHttp[method](`*/api/v1${path}`, () =>
      guarded(() => {
        throw notImplemented(id);
      }),
    ),
  );
}

/** Any other `/api/v1` request: `501 not-implemented`. Registered last. */
export function catchAllHandlers() {
  return [
    mswHttp.all("*/api/v1/*", ({ request }) =>
      guarded(() => {
        throw notImplemented(`${request.method} ${new URL(request.url).pathname}`);
      }),
    ),
  ];
}
