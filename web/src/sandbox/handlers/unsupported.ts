// D7: what the demo does not offer answers `501 not-implemented`, as the server answers an operation
// it has not implemented (server/src/api.ts `notImplemented`). An operation the contract secures
// checks the session first, as the server's authentication hook runs before any handler (401), and
// `exportResults` also the survey (404 for an unknown or invisible one, server/src/results/service.ts
// `exportResults` finds the survey before it writes a format).
import { http as mswHttp } from "msw";
import { requireSession, view } from "./common";
import type { HandlerContext } from "./context";
import { notImplemented, guarded } from "./problems";
import { visibleSurvey } from "./survey-access";

interface Unsupported {
  readonly id: string;
  readonly method: "get" | "post" | "put" | "patch" | "delete";
  readonly path: string;
  /** What is checked before the 501: nothing (a public operation), the session, or the survey too. */
  readonly before: "nothing" | "session" | "survey";
}

const UNSUPPORTED: readonly Unsupported[] = [
  { id: "login", method: "get", path: "/auth/login", before: "nothing" },
  { id: "loginCallback", method: "get", path: "/auth/callback", before: "nothing" },
  { id: "passwordLogin", method: "post", path: "/auth/password/login", before: "nothing" },
  { id: "setPasswordWithLink", method: "post", path: "/auth/password-link", before: "nothing" },
  { id: "changeOwnPassword", method: "post", path: "/me/password", before: "session" },
  { id: "replaceCurrentCredential", method: "post", path: "/me/credential", before: "session" },
  { id: "listApiTokens", method: "get", path: "/api-tokens", before: "session" },
  { id: "createApiToken", method: "post", path: "/api-tokens", before: "session" },
  {
    id: "revokeLegacyAccessKey",
    method: "delete",
    path: "/api-tokens/legacy-key",
    before: "session",
  },
  { id: "revokeApiToken", method: "delete", path: "/api-tokens/:tokenId", before: "session" },
  { id: "listUsers", method: "get", path: "/admin/users", before: "session" },
  { id: "createUser", method: "post", path: "/admin/users", before: "session" },
  { id: "updateUser", method: "patch", path: "/admin/users/:userId", before: "session" },
  { id: "deleteUser", method: "delete", path: "/admin/users/:userId", before: "session" },
  {
    id: "createUserResetLink",
    method: "post",
    path: "/admin/users/:userId/reset-link",
    before: "session",
  },
  {
    id: "listUserIdentities",
    method: "get",
    path: "/admin/users/:userId/identities",
    before: "session",
  },
  {
    id: "unlinkUserIdentity",
    method: "delete",
    path: "/admin/users/:userId/identities/:provider/:subject",
    before: "session",
  },
  {
    id: "exportResults",
    method: "get",
    path: "/surveys/:surveyId/results/export",
    before: "survey",
  },
  {
    id: "receiveAccountDeleted",
    method: "post",
    path: "/webhooks/account-deleted",
    before: "nothing",
  },
  // The bridge's public operations: the demo handlers arrive with a later task of hosted Step 5.
  {
    id: "getPublicDefinition",
    method: "get",
    path: "/public/surveys/:surveyId/definition",
    before: "nothing",
  },
  {
    id: "getRespondentState",
    method: "get",
    path: "/public/surveys/:surveyId/respondents/:clientId",
    before: "nothing",
  },
  {
    id: "getRespondentStateByResultId",
    method: "get",
    path: "/public/results/:resultId/respondents/:clientId",
    before: "nothing",
  },
  {
    id: "submitResponseByPostId",
    method: "post",
    path: "/public/posts/:postId/responses",
    before: "nothing",
  },
  {
    id: "uploadResponseFileByPostId",
    method: "post",
    path: "/public/posts/:postId/files",
    before: "nothing",
  },
  {
    id: "getQuestionSummary",
    method: "get",
    path: "/public/results/:resultId/questions/:name",
    before: "nothing",
  },
  {
    id: "getLegacyFile",
    method: "get",
    path: "/public/legacy-files/:kind/:name",
    before: "nothing",
  },
];

/** The operation ids of the contract the demo does not support. */
export const UNSUPPORTED_OPERATIONS: readonly string[] = UNSUPPORTED.map((entry) => entry.id);

/** The operation ids the demo answers with 501 only after checking the session. */
export const SECURED_UNSUPPORTED_OPERATIONS: readonly string[] = UNSUPPORTED.filter(
  (entry) => entry.before !== "nothing",
).map((entry) => entry.id);

export function unsupportedHandlers(ctx: HandlerContext) {
  return UNSUPPORTED.map(({ id, method, path, before }) =>
    mswHttp[method](`*/api/v1${path}`, ({ params, cookies }) =>
      guarded(() => {
        if (before === "session") requireSession(ctx, cookies);
        if (before === "survey") {
          view(ctx, cookies, (data, user) => visibleSurvey(data, user, String(params.surveyId)));
        }
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
