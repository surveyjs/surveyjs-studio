import type { Handlers } from "../api.js";
import type { Clock } from "../auth/session.js";
import { AppError } from "../errors.js";
import type { EraseAccount } from "./erasure.js";
import { verifyWebhook } from "./webhook.js";
import { webhookKey } from "./webhook-secret.js";
import { GUID } from "../domain/guid.js";

export interface AccountHandlersOptions {
  /** `ACCOUNT_WEBHOOK_SECRET`; null: the webhook answers 404. Secret: never log or echo. */
  readonly webhookSecret: string | null;
  readonly eraseAccount: EraseAccount;
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
 * the erasure trusts the signed message and does not ask the user directory (R10). Logs carry the
 * webhook id and the reason only.
 */
export function createAccountHandlers(options: AccountHandlersOptions): Handlers {
  const { webhookSecret, eraseAccount, now = Date.now } = options;
  const key = webhookSecret === null ? null : webhookKey(webhookSecret);

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
      await eraseAccount(userId, { now: new Date(now()).toISOString() });
      return reply.code(204).send();
    },
  };
}
