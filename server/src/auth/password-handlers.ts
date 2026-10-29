import { createHash, randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import type { Handlers } from "../api.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { dummyHash, hashPassword, verifyPassword } from "../passwords/hash.js";
import type { Lockout } from "../passwords/lockout.js";
import { passwordProblem } from "../passwords/policy.js";
import type { LocalAccountStore } from "../providers/types.js";
import { requireUser } from "./authenticate.js";
import { hasPasswordAdmin } from "./bootstrap.js";
import { sessionCookies } from "./cookies.js";
import { generateCsrfToken, sameInConstantTime } from "./csrf.js";
import type { SessionCheck } from "./session-check.js";
import { createSession, encodeSession, type Clock } from "./session.js";

export interface PasswordHandlerOptions {
  readonly config: AppConfig;
  readonly accounts: LocalAccountStore;
  readonly sessionCheck: SessionCheck;
  readonly lockout: Lockout;
  /** The first admin's setup link while there is no admin (bootstrapFirstAdmin). */
  readonly setupToken: string | null;
  readonly now?: Clock;
}

/** The token of a set-password link as stored: its SHA-256, base64url. */
export const linkTokenHash = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("base64url");

const invalidCredentials = (status: 401 | 403): AppError =>
  new AppError({
    code: "invalid-credentials",
    status,
    title: status === 401 ? "Sign-in failed" : "Wrong password",
    detail:
      status === 401 ? "The email or the password is wrong." : "The current password is wrong.",
  });

function locked(retryAfterSeconds: number): AppError {
  return new AppError({
    code: "account-locked",
    status: 429,
    title: "Too many failed sign-ins",
    detail: `Too many failed attempts. Try again in ${String(Math.ceil(retryAfterSeconds / 60))} minute(s).`,
  });
}

function weakPassword(problem: string): AppError {
  return new AppError({
    code: "password-too-weak",
    status: 422,
    title: "Password too weak",
    detail: problem,
  });
}

const linkInvalid = (): AppError =>
  new AppError({
    code: "link-invalid",
    status: 410,
    title: "Link not valid",
    detail: "This link was used already, has expired, or is not a link of this site.",
  });

/** `passwordLogin`, `changeOwnPassword` and `setPasswordWithLink` (USER_DIRECTORY=local). */
export function createPasswordHandlers(options: PasswordHandlerOptions): Handlers {
  const { config, accounts, sessionCheck, lockout } = options;
  const now = options.now ?? Date.now;
  const nowIso = () => new Date(now()).toISOString();
  let setupToken = options.setupToken;

  const cookiesFor = (
    user: { sub: string; name: string; email: string },
    epoch: number,
  ): string[] => {
    const csrf = generateCsrfToken();
    const session = createSession(
      { ...user, avatarUrl: null },
      csrf,
      config.sessionMaxAgeSeconds,
      now,
      epoch,
    );
    return sessionCookies(config, { session: encodeSession(config.sessionSecret, session), csrf });
  };

  /**
   * Starts an attempt for the email: refused while its back-off lasts, saying when to try again
   * (the error keeps the header); otherwise counted as a failure until it succeeds, before any
   * await, so attempts running together cannot all pass the lock.
   */
  const beginAttempt = (email: string, reply: FastifyReply) => {
    const wait = lockout.begin(email);
    if (wait > 0) {
      void reply.header("retry-after", String(wait));
      throw locked(wait);
    }
  };

  /**
   * The answer of a link that set a password: 204 with a session of the new epoch, so the user lands
   * signed in (S19), when the account may sign in; a disabled account gets no session.
   */
  const signInWithLink = async (reply: FastifyReply, userId: string, epoch: number) => {
    const account = await accounts.account(userId);
    if (!account || account.status !== "active") return reply.code(204).send();
    await accounts.recordSignIn(account.user.id, nowIso());
    const user = {
      sub: account.user.id,
      name: account.user.displayName,
      email: account.user.email,
    };
    return reply.code(204).header("set-cookie", cookiesFor(user, epoch)).send();
  };

  return {
    passwordLogin: async (request, reply) => {
      const { email, password } = request.body as { email: string; password: string };
      beginAttempt(email, reply);
      const account = await accounts.accountByEmail(email);
      // An unknown email is checked against a dummy hash, so both answers take as long.
      const hash = account?.passwordHash ?? (await dummyHash());
      const matches = await verifyPassword(password, hash);
      if (!account || account.passwordHash === null || !matches || account.status !== "active") {
        throw invalidCredentials(401);
      }
      lockout.succeeded(email);
      if (!config.readOnly) await accounts.recordSignIn(account.user.id, nowIso());
      const user = {
        sub: account.user.id,
        name: account.user.displayName,
        email: account.user.email,
      };
      return reply.code(204).header("set-cookie", cookiesFor(user, account.sessionEpoch)).send();
    },

    changeOwnPassword: async (request, reply) => {
      const signedIn = requireUser(request);
      const { currentPassword, newPassword } = request.body as {
        currentPassword: string;
        newPassword: string;
      };
      const account = await accounts.account(signedIn.id);
      if (!account || account.passwordHash === null) {
        throw new AppError({
          code: "not-implemented",
          status: 501,
          title: "Not implemented",
          detail: "This account has no password here.",
        });
      }
      beginAttempt(account.user.email, reply);
      if (!(await verifyPassword(currentPassword, account.passwordHash))) {
        throw invalidCredentials(403);
      }
      lockout.succeeded(account.user.email);
      // The forced change must replace the password from the settings (spec S4).
      if (newPassword === currentPassword) {
        throw weakPassword("Choose a password different from the current one.");
      }
      const problem = passwordProblem(newPassword);
      if (problem !== null) throw weakPassword(problem);
      const epoch = await accounts.setPassword(account.user.id, await hashPassword(newPassword), {
        mustChange: false,
      });
      sessionCheck.forget(account.user.id);
      const user = {
        sub: account.user.id,
        name: account.user.displayName,
        email: account.user.email,
      };
      return reply
        .code(204)
        .header("set-cookie", cookiesFor(user, epoch ?? account.sessionEpoch + 1))
        .send();
    },

    setPasswordWithLink: async (request, reply) => {
      const { token, password, email, displayName } = request.body as {
        token: string;
        password: string;
        email?: string;
        displayName?: string;
      };
      if (setupToken !== null && sameInConstantTime(token, setupToken)) {
        if (email === undefined || displayName === undefined) {
          throw new AppError({
            code: "bad-request",
            status: 400,
            title: "Bad request",
            detail: "The first admin's email and name are required.",
          });
        }
        const problem = passwordProblem(password);
        if (problem !== null) throw weakPassword(problem);
        // Taken before any await, so two submits at once cannot both create an admin; given back
        // when this one does not create it.
        const claimed = setupToken;
        setupToken = null;
        try {
          if (await hasPasswordAdmin(accounts)) throw linkInvalid();
          if (await accounts.accountByEmail(email)) {
            setupToken = claimed;
            throw new AppError({
              code: "bad-request",
              status: 400,
              title: "Bad request",
              detail: "An account with this email exists. Choose another email.",
            });
          }
          const admin = await accounts.createAccount({
            id: randomUUID(),
            email,
            displayName,
            instanceRole: "admin",
            status: "active",
            passwordHash: await hashPassword(password),
            mustChangePassword: false,
            createdAt: nowIso(),
          });
          // The new admin lands signed in, as a user who sets a password with a link (S19).
          return await signInWithLink(reply, admin.user.id, admin.sessionEpoch);
        } catch (error) {
          // A store failure keeps the link usable; an admin made meanwhile ends it for good.
          if (!(error instanceof AppError)) setupToken = claimed;
          throw error;
        }
      }
      // The rules first: a weak password does not use the link up.
      const problem = passwordProblem(password);
      if (problem !== null) throw weakPassword(problem);
      // The link is used and the password stored together: a failed write keeps the link.
      const used = await accounts.usePasswordLink(
        linkTokenHash(token),
        nowIso(),
        await hashPassword(password),
      );
      if (used === null) throw linkInvalid();
      sessionCheck.forget(used.userId);
      return signInWithLink(reply, used.userId, used.epoch);
    },
  };
}
