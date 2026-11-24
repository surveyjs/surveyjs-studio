import type { FastifyBaseLogger } from "fastify";
import type { Handlers } from "../api.js";
import type { SessionCheck } from "../auth/session-check.js";
import type { Clock } from "../auth/session.js";
import { AppError } from "../errors.js";
import type { LocalAccountStore } from "../providers/types.js";
import type { EraseAccount } from "./erasure.js";
import { verifyWebhook } from "./webhook.js";
import { webhookKey } from "./webhook-secret.js";
import { GUID } from "../domain/guid.js";

export interface AccountHandlersOptions {
  /** `ACCOUNT_WEBHOOK_SECRET`; null: the webhook answers 404. Secret: never log or echo. */
  readonly webhookSecret: string | null;
  readonly eraseAccount: EraseAccount;
  /** USER_DIRECTORY=local. With `hosted`, the webhook deletes the account as well (ADR 0043). */
  readonly accounts?: LocalAccountStore | null;
  /** APP_EDITION=hosted: `data.userId` is a surveyjs.io id. */
  readonly hosted?: boolean;
  /** Forgets the deleted account at once on this server. */
  readonly sessionCheck?: SessionCheck | null;
  readonly now?: Clock;
}

const LOGGABLE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const badRequest = (detail: string) =>
  new AppError({ code: "bad-request", status: 400, title: "Bad request", detail });

/** A header's single value; a repeated header counts as missing. */
function header(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The account-deleted webhook (R10). The signature is checked on the raw text before it is parsed;
 * the erasure trusts the signed message and does not ask the user directory (R10). Logs carry ids
 * and the reason only, never an email.
 *
 * Hosted with local accounts (ADR 0043 point 2), `data.userId` is the surveyjs.io id: the account
 * is the one whose `surveyjs` identity has that subject, else the one with that id. It is
 * disabled first (so it stops signing in should a later step fail), its data erased (and the
 * data under the surveyjs.io id, when the account's id is another), then the account deleted with
 * its identities. The last instance admin goes too: the person is gone from surveyjs.io, and with
 * no active admin left ADMIN_EMAIL is made admin at its next sign-in. An id no account has: its
 * data, if any, is erased. Any store failure answers 5xx, so the site retries.
 */
export function createAccountHandlers(options: AccountHandlersOptions): Handlers {
  const { webhookSecret, eraseAccount, now = Date.now, sessionCheck = null } = options;
  const key = webhookSecret === null ? null : webhookKey(webhookSecret);
  const accounts = options.hosted ? (options.accounts ?? null) : null;

  /** Erases the data of `userId` and, hosted, deletes its account. */
  const erase = async (userId: string, log: FastifyBaseLogger): Promise<void> => {
    const at = { now: new Date(now()).toISOString() };
    if (accounts === null) {
      await eraseAccount(userId, at);
      return;
    }
    const account =
      (await accounts.accountByIdentity("surveyjs", userId.toLowerCase())) ??
      (await accounts.account(userId));
    if (account === null) {
      await eraseAccount(userId, at);
      return;
    }
    const { id } = account.user;
    const allow = { allowLastInstanceAdmin: true };
    const wasActiveAdmin = account.instanceRole === "admin" && account.status === "active";
    await accounts.updateAccount(id, { status: "disabled" }, allow);
    sessionCheck?.forget(id);
    await eraseAccount(id, at);
    // The same person's data under the surveyjs.io id (legacy rows), when the account's id is another.
    if (id !== userId.toLowerCase()) await eraseAccount(userId, at);
    await accounts.deleteAccount(id, allow);
    sessionCheck?.forget(id);
    if (wasActiveAdmin && (await accounts.countActiveAdmins()) === 0) {
      log.warn(
        { userId: id },
        "the deleted surveyjs.io account was the last instance admin: ADMIN_EMAIL is made admin at its next sign-in",
      );
    }
  };

  return {
    receiveAccountDeleted: async (request, reply) => {
      if (key === null) {
        throw new AppError({ code: "not-found", status: 404, title: "Not found" });
      }
      const id = header(request.headers["webhook-id"]);
      const webhookId = id !== undefined && LOGGABLE_ID.test(id) ? id : "(invalid)";
      const body = typeof request.body === "string" ? request.body : "";
      const check = verifyWebhook(
        {
          id,
          timestamp: header(request.headers["webhook-timestamp"]),
          signature: header(request.headers["webhook-signature"]),
          body,
        },
        key,
        now(),
      );
      if (check !== "valid") {
        request.log.warn({ webhookId, reason: check }, "Refused an account-deleted webhook.");
        throw new AppError({
          code: "invalid-signature",
          status: 401,
          title: "Invalid signature",
          detail: "The webhook signature is missing, wrong or too old.",
        });
      }

      let event: unknown;
      try {
        event = JSON.parse(body);
      } catch {
        throw badRequest("The body must be an account event.");
      }
      if (!isObject(event) || typeof event.type !== "string") {
        throw badRequest("The body must be an account event.");
      }
      if (event.type !== "account.deleted") {
        request.log.info({ webhookId }, "Ignored a webhook event of another type.");
        return reply.code(204).send();
      }
      const userId = isObject(event.data) ? event.data.userId : undefined;
      if (typeof userId !== "string" || !GUID.test(userId)) {
        throw badRequest("data.userId must be a user ID.");
      }
      await erase(userId, request.log);
      return reply.code(204).send();
    },
  };
}
