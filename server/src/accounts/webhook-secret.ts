const PREFIX = "whsec_";
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The smallest secret Standard Webhooks allows. */
export const MIN_WEBHOOK_SECRET_BYTES = 24;

/** Whether `value` is `whsec_` followed by the base64 of at least 24 bytes (R10). */
export function isWebhookSecret(value: string): boolean {
  if (!value.startsWith(PREFIX)) return false;
  const encoded = value.slice(PREFIX.length);
  if (encoded.length % 4 !== 0 || !BASE64.test(encoded)) return false;
  return Buffer.from(encoded, "base64").length >= MIN_WEBHOOK_SECRET_BYTES;
}

/** The HMAC key of a `whsec_` secret: its decoded bytes. Throws (without the value) for anything else. */
export function webhookKey(secret: string): Buffer {
  if (!isWebhookSecret(secret)) throw new Error("ACCOUNT_WEBHOOK_SECRET is not a whsec_ secret");
  return Buffer.from(secret.slice(PREFIX.length), "base64");
}
