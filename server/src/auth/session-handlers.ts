import type { components } from "@my-surveys/contract";
import type { Handlers } from "../api.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { linkNotices, type AccountNotices } from "../notices/account-notices.js";
import type { Directory } from "../providers/types.js";
import { shellLinks } from "../shell-links.js";
import { requireUser } from "./authenticate.js";
import {
  clearAllCookies,
  clearTransactionCookie,
  parseCookies,
  SESSION_COOKIE,
  sessionCookies,
  transactionCookie,
  transactionCookieName,
  transactionCookieNames,
} from "./cookies.js";
import { generateCsrfToken, sameInConstantTime } from "./csrf.js";
import { publicUrl, type IdentityClaims, type IdentityProvider } from "./identity.js";
import { validateReturnTo } from "./return-to.js";
import {
  createSession,
  decodeSession,
  encodeSession,
  type Clock,
  type SessionUser,
} from "./session.js";
import { createTransaction, decodeTransaction, encodeTransaction } from "./transaction.js";

type CurrentUser = components["schemas"]["CurrentUser"];

export interface SessionHandlerOptions {
  readonly config: AppConfig;
  readonly identity: IdentityProvider;
  readonly directory: Directory;
  readonly notices: AccountNotices;
  readonly now?: Clock;
}

function badRequest(detail: string): AppError {
  return new AppError({ code: "bad-request", status: 400, title: "Bad request", detail });
}

/** The `picture` claim when it is an absolute http(s) URL; anything else is no avatar. */
function avatarUrl(picture: string | undefined): string | null {
  if (picture === undefined || !URL.canParse(picture)) return null;
  return /^https?:$/.test(new URL(picture).protocol) ? picture : null;
}

/**
 * The account in the directory wins over the provider's claims; without one, the claims are used.
 * A blocked account, or an identity without an email address, gets no session.
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
  const email = user?.email || claims.email;
  if (!email) {
    throw badRequest("The identity provider did not share an email address for this account.");
  }
  return {
    sub: claims.sub,
    name: user?.displayName ?? (claims.name || email),
    email,
    avatarUrl: avatarUrl(claims.picture),
  };
}

/** `login`, `loginCallback`, `logout` and `getCurrentUser`. */
export function createSessionHandlers(options: SessionHandlerOptions): Handlers {
  const { config, identity, directory, notices, now } = options;
  const secret = config.sessionSecret;
  const links = shellLinks(config.shellLinks);

  return {
    login: async (request, reply) => {
      const { returnTo } = request.query as { returnTo?: string };
      const path = validateReturnTo(returnTo, config.publicBaseUrl);
      if (path === null) throw badRequest("returnTo must be a path on this site.");
      const tx = createTransaction(path, now);
      const name = transactionCookieName(tx.state);
      if (name === null) throw new Error("the sign-in state cannot name its cookie");
      const location = await identity.authorizationUrl(tx);
      return reply
        .header("set-cookie", transactionCookie(config, name, encodeTransaction(secret, tx)))
        .redirect(location.href, 302);
    },

    loginCallback: async (request, reply) => {
      const { state } = request.query as { state: string };
      const cookies = parseCookies(request.headers.cookie);
      // Each sign-in has its own transaction cookie, named after its state. It is single-use:
      // cleared whatever the outcome; other sign-ins' cookies are left alone.
      const name = transactionCookieName(state);
      if (name !== null) void reply.header("set-cookie", clearTransactionCookie(config, name));
      const tx = name === null ? null : decodeTransaction(secret, cookies[name], now);
      if (!tx || !sameInConstantTime(state, tx.state)) {
        // Already signed in (say, the callback was opened again): go to the start page.
        if (decodeSession(secret, cookies[SESSION_COOKIE], now)) {
          return reply.redirect(publicUrl(config.publicBaseUrl, "/"), 302);
        }
        throw badRequest("The sign-in expired or was not started in this browser. Sign in again.");
      }
      // The URL the browser opened: the public origin (PUBLIC_BASE_URL has no path) with this
      // request's path and query.
      const claims = await identity.finishSignIn(
        new URL(new URL(config.publicBaseUrl).origin + request.url),
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

    // Also answers without a session (the authentication hook lets anonymous calls through), so
    // a user whose session expired still leaves the identity provider's session.
    logout: async (request, reply) => {
      const transactions = transactionCookieNames(parseCookies(request.headers.cookie));
      void reply.header("set-cookie", clearAllCookies(config, transactions));
      return { redirectUrl: await identity.endSessionUrl() };
    },

    getCurrentUser: async (request): Promise<CurrentUser> => {
      const user = requireUser(request);
      // Notices are secondary: when their store fails, the user still gets the app (as on
      // surveyjs.io, where a failed licence check shows no dialog), and the failure is logged.
      let current: CurrentUser["notices"] = [];
      try {
        current = linkNotices(await notices.noticesFor(user.id), links);
      } catch (error) {
        request.log.error({ err: error }, "account notices are unavailable");
      }
      return { ...user, notices: current };
    },
  };
}
