import type { components } from "@my-surveys/contract";
import type { Handlers } from "../api.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { Directory } from "../providers/types.js";
import { requireUser } from "./authenticate.js";
import {
  clearAllCookies,
  clearTransactionCookie,
  parseCookies,
  sessionCookies,
  TRANSACTION_COOKIE,
  transactionCookie,
} from "./cookies.js";
import { generateCsrfToken, sameInConstantTime } from "./csrf.js";
import { publicUrl, type IdentityClaims, type IdentityProvider } from "./identity.js";
import { validateReturnTo } from "./return-to.js";
import { createSession, encodeSession, type Clock, type SessionUser } from "./session.js";
import { createTransaction, decodeTransaction, encodeTransaction } from "./transaction.js";

type CurrentUser = components["schemas"]["CurrentUser"];

export interface SessionHandlerOptions {
  readonly config: AppConfig;
  readonly identity: IdentityProvider;
  readonly directory: Directory;
  readonly now?: Clock;
}

function badRequest(detail: string): AppError {
  return new AppError({ code: "bad-request", status: 400, title: "Bad request", detail });
}

/**
 * The account in the directory wins over the provider's claims; without one, the claims are used.
 * A blocked account gets no session.
 */
async function sessionUser(directory: Directory, claims: IdentityClaims): Promise<SessionUser> {
  const user = await directory.getUser(claims.sub);
  if (user?.blocked) {
    throw new AppError({
      code: "forbidden",
      status: 403,
      title: "Account blocked",
      detail: "This account is blocked.",
    });
  }
  return {
    sub: claims.sub,
    name: user?.displayName ?? (claims.name || claims.email || claims.sub),
    email: user?.email ?? claims.email ?? "",
    avatarUrl: claims.picture ?? null,
  };
}

/** `login`, `loginCallback`, `logout` and `getCurrentUser`. */
export function createSessionHandlers(options: SessionHandlerOptions): Handlers {
  const { config, identity, directory, now } = options;
  const secret = config.sessionSecret;

  return {
    login: async (request, reply) => {
      const { returnTo } = request.query as { returnTo?: string };
      const path = validateReturnTo(returnTo, config.publicBaseUrl);
      if (path === null) throw badRequest("returnTo must be a path on this site.");
      const tx = createTransaction(path, now);
      const location = await identity.authorizationUrl(tx);
      return reply
        .header("set-cookie", transactionCookie(config, encodeTransaction(secret, tx)))
        .redirect(location.href, 302);
    },

    loginCallback: async (request, reply) => {
      // The transaction is single-use: cleared whatever the outcome.
      void reply.header("set-cookie", clearTransactionCookie(config));
      const { state } = request.query as { state: string };
      const sealed = parseCookies(request.headers.cookie)[TRANSACTION_COOKIE];
      const tx = decodeTransaction(secret, sealed, now);
      if (!tx || !sameInConstantTime(state, tx.state)) {
        throw badRequest("The sign-in expired or was not started in this browser. Sign in again.");
      }
      const claims = await identity.finishSignIn(
        new URL(publicUrl(config.publicBaseUrl, request.url)),
        tx,
      );
      const user = await sessionUser(directory, claims);
      const csrf = generateCsrfToken();
      const session = createSession(user, csrf, config.sessionMaxAgeSeconds, now);
      return reply
        .header(
          "set-cookie",
          sessionCookies(config, { session: encodeSession(secret, session), csrf }),
        )
        .redirect(publicUrl(config.publicBaseUrl, tx.returnTo), 302);
    },

    logout: async (_request, reply) => {
      void reply.header("set-cookie", clearAllCookies(config));
      return { redirectUrl: await identity.endSessionUrl() };
    },

    getCurrentUser: (request): CurrentUser => {
      const user = requireUser(request);
      // Account notices (licence expiry) arrive with the shell.
      return { ...user, notices: [] };
    },
  };
}
