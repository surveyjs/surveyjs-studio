import type { components } from "@surveyjs-studio/contract";
import type { Handlers } from "../api.js";
import type { AppConfig, ExternalMethod } from "../config.js";
import { AppError } from "../errors.js";
import { loggableError } from "../logging.js";
import { linkNotices, type AccountNotices } from "../notices/account-notices.js";
import type { InvitationStore, LocalAccountStore, UserDirectory } from "../providers/types.js";
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
import { resolveExternalSignIn } from "./external-sign-in.js";
import { publicUrl, type IdentityClaims } from "./identity.js";
import type { SignInProviders } from "./providers/index.js";
import { validateReturnTo } from "./return-to.js";
import type { SessionCheck } from "./session-check.js";
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
  readonly signIn: SignInProviders;
  readonly users: UserDirectory;
  /**
   * USER_DIRECTORY=local: `getCurrentUser` adds the account's role, forced change and whether it
   * has a password; an external provider's sign-in goes to a local account (D3).
   */
  readonly accounts?: LocalAccountStore | null;
  /** USER_DIRECTORY=local: claimed at every external sign-in (D4). */
  readonly invitations?: InvitationStore | null;
  /** USER_DIRECTORY=local: forgets the account an external sign-in may have just made active. */
  readonly sessionCheck?: SessionCheck | null;
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
 * Why the callback sends the browser to `/sign-in/refused` (the page's `reason`). The refusals of
 * `resolveExternalSignIn` add `not-invited`.
 */
type RefusalReason =
  | "cancelled"
  | "unavailable"
  | "read-only"
  | "expired"
  | "failed"
  | "disabled"
  | "email-unverified";

/** A sign-in the callback refuses: the problem an API client gets, and the browser's reason. */
interface Refusal {
  readonly reason: RefusalReason;
  readonly problem: AppError;
}

/** The provider errors that say the provider has trouble, not the sign-in (RFC 6749 4.1.2.1). */
const PROVIDER_FAULTS: ReadonlySet<string> = new Set(["server_error", "temporarily_unavailable"]);

/** A browser opening the callback asks for HTML; an API client does not. */
const acceptsHtml = (accept: string | undefined): boolean => /\btext\/html\b/i.test(accept ?? "");

/**
 * The account in the user directory wins over the provider's claims; without one, the claims are used.
 * A blocked account, or an identity without an email address, gets no session.
 */
async function sessionUser(
  users: UserDirectory,
  claims: IdentityClaims,
): Promise<SessionUser | Refusal> {
  const user = await users.signInUser(claims);
  if (user?.blocked) {
    const problem = new AppError({
      code: "forbidden",
      status: 403,
      title: "Account blocked",
      detail: "This account is blocked.",
    });
    return { reason: "disabled", problem };
  }
  const email = user?.email || claims.email;
  if (!email) {
    const detail = "The identity provider did not share an email address for this account.";
    return { reason: "email-unverified", problem: badRequest(detail) };
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
  const { config, signIn, users, notices, now } = options;
  const nowIso = () => new Date((now ?? Date.now)()).toISOString();
  const secret = config.sessionSecret;
  const links = shellLinks(config.shellLinks);

  return {
    login: async (request, reply) => {
      const { returnTo, provider } = request.query as {
        returnTo?: string;
        provider?: ExternalMethod;
      };
      const path = validateReturnTo(returnTo, config.publicBaseUrl);
      if (path === null) throw badRequest("returnTo must be a path on this site.");
      // A method that is not enabled has no provider, whether or not the name is a known one.
      const chosen = provider === undefined ? undefined : signIn.byMethod.get(provider);
      if (provider !== undefined && !chosen)
        throw badRequest("This sign-in method is not enabled.");
      const tx = createTransaction(path, provider, now);
      const name = transactionCookieName(tx.state);
      if (name === null) throw new Error("the sign-in state cannot name its cookie");
      const location = await (chosen ?? signIn.primary).authorizationUrl(tx);
      return reply
        .header("set-cookie", transactionCookie(config, name, encodeTransaction(secret, tx)))
        .redirect(location.href, 302);
    },

    loginCallback: async (request, reply) => {
      const { state, error } = request.query as { state: string; error?: string };
      const cookies = parseCookies(request.headers.cookie);
      // Each sign-in has its own transaction cookie, named after its state. It is single-use:
      // cleared whatever the outcome; other sign-ins' cookies are left alone.
      const name = transactionCookieName(state);
      if (name !== null) void reply.header("set-cookie", clearTransactionCookie(config, name));
      const decoded = name === null ? null : decodeTransaction(secret, cookies[name], now);
      const tx = decoded && sameInConstantTime(state, decoded.state) ? decoded : null;
      // The method of the sign-in: its button's, else the instance's own (surveyjs.io alone).
      const method = tx?.provider ?? signIn.primaryMethod;

      // A failed sign-in ends on the refused page rather than on a problem answer that the
      // browser shows as raw JSON (D8). A browser (it asks for HTML) goes there for every failure.
      // An API client gets the problem answers, except for the failures of a sign-in started by
      // a provider's button that always go to the page: cancelled, unavailable and read-only.
      const browser = acceptsHtml(request.headers.accept);
      const button = tx?.provider !== undefined;
      const toRefusedPage = (reason: string) => {
        const query = new URLSearchParams({ reason, provider: method ?? "" });
        return reply.redirect(
          publicUrl(config.publicBaseUrl, `/sign-in/refused?${query.toString()}`),
          302,
        );
      };
      // Never the email or the subject (D8).
      const refuse = (reason: string) => {
        request.log.info({ provider: method, reason }, "sign-in refused");
        return toRefusedPage(reason);
      };
      /** The refused page for a browser; the problem answer for an API client. */
      const fail = ({ reason, problem }: Refusal) => {
        if (!browser) throw problem;
        return refuse(reason);
      };

      if (!tx) {
        // Already signed in (say, the callback was opened again): go to the start page.
        if (decodeSession(secret, cookies[SESSION_COOKIE], now)) {
          return reply.redirect(publicUrl(config.publicBaseUrl, "/"), 302);
        }
        const detail = "The sign-in expired or was not started in this browser. Sign in again.";
        return fail({ reason: "expired", problem: badRequest(detail) });
      }
      const identity =
        tx.provider === undefined ? signIn.primary : signIn.byMethod.get(tx.provider);
      if (!identity) {
        return fail({
          reason: "failed",
          problem: badRequest("This sign-in method is not enabled."),
        });
      }
      // The provider's own error (RFC 6749 section 4.1.2.1). Any other error of an API client's
      // sign-in goes on to `finishSignIn`, which answers it with a 400.
      if (error === "access_denied" && (browser || button)) return refuse("cancelled");
      if (error !== undefined && browser) {
        if (!PROVIDER_FAULTS.has(error)) return refuse("failed");
        request.log.error({ provider: method, providerError: error }, "sign-in is unavailable");
        return toRefusedPage("unavailable");
      }

      try {
        let claims: IdentityClaims;
        try {
          // The URL the browser opened: the public origin (PUBLIC_BASE_URL has no path) with
          // this request's path and query.
          claims = await identity.finishSignIn(
            new URL(new URL(config.publicBaseUrl).origin + request.url),
            tx,
          );
        } catch (cause) {
          // A bad or reused code (400): the sign-in is not valid, the server is fine.
          if (cause instanceof AppError && cause.status < 500) {
            return fail({ reason: "failed", problem: cause });
          }
          if (!browser && !button) throw cause;
          request.log.error(
            { err: loggableError(cause), provider: method },
            "sign-in is unavailable",
          );
          return toRefusedPage("unavailable");
        }
        // The local directory with an external provider behind the sign-in: a local account (D3).
        // The dev provider's sign-ins keep the path below: their subject is the local id already.
        const { accounts, invitations, sessionCheck } = options;
        let user: SessionUser;
        let epoch: number | undefined;
        if (accounts && invitations && method !== null) {
          let result: Awaited<ReturnType<typeof resolveExternalSignIn>>;
          try {
            result = await resolveExternalSignIn(method, claims, {
              accounts,
              invitations,
              policy: config.joinPolicy,
              now: nowIso,
              readOnly: config.readOnly,
            });
          } catch (cause) {
            const readOnly = cause instanceof AppError && cause.code === "read-only";
            if (readOnly && (browser || button)) return refuse("read-only");
            throw cause;
          }
          if (!result.ok) return refuse(result.reason);
          const { account } = result;
          if (!config.readOnly) {
            await invitations.claimInvitations(account.user.id, account.user.email, {
              now: nowIso(),
            });
            await accounts.recordSignIn(account.user.id, nowIso());
          }
          sessionCheck?.forget(account.user.id);
          user = {
            sub: account.user.id,
            name: account.user.displayName,
            email: account.user.email,
            avatarUrl: avatarUrl(claims.picture),
          };
          epoch = account.sessionEpoch;
        } else {
          const found = await sessionUser(users, claims);
          if ("problem" in found) return fail(found);
          user = found;
        }
        const csrf = generateCsrfToken();
        const session = createSession(user, csrf, config.sessionMaxAgeSeconds, now, epoch);
        return reply
          .header(
            "set-cookie",
            sessionCookies(config, { session: encodeSession(secret, session), csrf }),
          )
          .redirect(publicUrl(config.publicBaseUrl, tx.returnTo), 302);
      } catch (cause) {
        // Anything else (the account store fails, say) is the server's fault. An API client gets
        // the problem answer; `fail` above threw only for one.
        if (!browser) throw cause;
        request.log.error({ err: loggableError(cause), provider: method }, "sign-in failed");
        return toRefusedPage("failed");
      }
    },

    // Also answers without a session (the authentication hook lets anonymous calls through), so
    // a user whose session expired still leaves the identity provider's session.
    logout: async (request, reply) => {
      const transactions = transactionCookieNames(parseCookies(request.headers.cookie));
      void reply.header("set-cookie", clearAllCookies(config, transactions));
      return { redirectUrl: await signIn.primary.endSessionUrl() };
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
      const account = options.accounts ? await options.accounts.account(user.id) : null;
      return {
        ...user,
        ...(account && {
          instanceRole: account.instanceRole,
          mustChangePassword: account.mustChangePassword,
          hasPassword: account.passwordHash !== null,
        }),
        notices: current,
      };
    },
  };
}
