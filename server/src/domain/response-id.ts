import { createHash } from "node:crypto";

/** Fixed UUID v5 namespace of response ids (S5). Never change it: ids already stored depend on it. */
export const RESPONSE_ID_NAMESPACE = "0a6f1e2c-5b7d-4c3a-9e81-6d2f4b8c1a73";

/** RFC 9562 UUID version 5: SHA-1 of the namespace's 16 bytes then the UTF-8 name; lower-case, dashed. */
export function uuidV5(namespace: string, name: string): string {
  const space = Buffer.from(namespace.replaceAll("-", ""), "hex");
  const hash = createHash("sha1").update(space).update(name, "utf8").digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** The response id for an Idempotency-Key: uuidV5(RESPONSE_ID_NAMESPACE, `${surveyId.toLowerCase()}:${key}`). */
export function responseIdFor(surveyId: string, key: string): string {
  return uuidV5(RESPONSE_ID_NAMESPACE, `${surveyId.toLowerCase()}:${key}`);
}
