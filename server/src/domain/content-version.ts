import { createHash } from "node:crypto";

/** SHA-256 of the UTF-8 text, base64url without padding (43 characters). */
export function contentVersion(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("base64url");
}
