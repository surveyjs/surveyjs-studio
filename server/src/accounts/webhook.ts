import { createHmac, timingSafeEqual } from "node:crypto";

/** The replay window: the timestamp may be this far from the server clock, either side (R10). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface WebhookMessage {
  readonly id: string | undefined; // header webhook-id
  readonly timestamp: string | undefined; // header webhook-timestamp (Unix seconds)
  readonly signature: string | undefined; // header webhook-signature
  /** The raw request body, as received. */
  readonly body: string;
}

export type WebhookCheck = "valid" | "missing" | "stale" | "bad-signature";

/** The base64 HMAC-SHA256 of `{id}.{timestamp}.{body}` (Standard Webhooks, version v1). */
export function webhookSignature(key: Buffer, id: string, timestamp: string, body: string): string {
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

/** The three headers of a signed message (for senders: the demo CLI and tests). */
export function signWebhook(
  key: Buffer,
  id: string,
  timestampSeconds: number,
  body: string,
): Record<string, string> {
  const timestamp = String(timestampSeconds);
  return {
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${webhookSignature(key, id, timestamp, body)}`,
  };
}

/**
 * R10: valid when the timestamp is within the window of `nowMs` and one of the space-separated
 * `v1,<base64>` signatures matches (compared in constant time). Checked before the body is parsed.
 */
export function verifyWebhook(message: WebhookMessage, key: Buffer, nowMs: number): WebhookCheck {
  const { id, timestamp, signature, body } = message;
  if (!id || !timestamp || !signature) return "missing";
  if (!/^[0-9]{1,15}$/.test(timestamp)) return "stale";
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) return "stale";
  const expected = Buffer.from(webhookSignature(key, id, timestamp, body), "base64");
  for (const part of signature.split(" ")) {
    const comma = part.indexOf(",");
    if (comma < 0 || part.slice(0, comma) !== "v1") continue;
    const given = Buffer.from(part.slice(comma + 1), "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return "valid";
  }
  return "bad-signature";
}
