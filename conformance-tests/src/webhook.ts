/**
 * A Standard Webhooks signer (standardwebhooks.com) for the account-deleted webhook tests. Kept
 * here, independent of the server, so a port is checked against the published scheme.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";

/** The HMAC key of a `whsec_` secret: the base64-decoded bytes after the prefix. */
export function webhookKey(secret: string): Buffer {
  if (!secret.startsWith("whsec_")) throw new Error("A webhook secret starts with whsec_");
  return Buffer.from(secret.slice("whsec_".length), "base64");
}

/** A key no server knows. */
export const randomWebhookKey = (): Buffer => randomBytes(32);

export interface SignOptions {
  /** Default: a fresh `msg_<uuid>`. */
  readonly id?: string;
  /** Unix seconds; default now. */
  readonly timestamp?: number;
}

/** The `webhook-id`, `webhook-timestamp` and `webhook-signature` headers of `body`. */
export function signWebhook(
  key: Buffer,
  body: string,
  options: SignOptions = {},
): Record<string, string> {
  const id = options.id ?? `msg_${randomUUID()}`;
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return {
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  };
}
