import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Sealed cookie values: AES-256-GCM, so the value is both encrypted and authenticated.
 *
 * Format (for ports to other platforms): `v1.<iv>.<ciphertext+tag>`, with `iv` (12 random bytes) and
 * `ciphertext+tag` (ciphertext followed by the 16-byte GCM tag) in base64url without padding.
 * The key is HKDF-SHA256(ikm = secret as UTF-8, salt = empty, info = purpose, 32 bytes). The purpose
 * is also the GCM additional authenticated data, so a value sealed for one cookie never opens as
 * another. Any failure (bad format, version, key, purpose or tampering) reads as "no value".
 */
export type SealPurpose = "msid-session-v1" | "msid-auth-v1";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function deriveKey(purpose: SealPurpose, secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), purpose, 32));
}

export function seal(purpose: SealPurpose, secret: string, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(purpose, secret), iv);
  cipher.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `${VERSION}.${iv.toString("base64url")}.${body.toString("base64url")}`;
}

export function unseal(purpose: SealPurpose, secret: string, value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const iv = Buffer.from(parts[1] ?? "", "base64url");
  const body = Buffer.from(parts[2] ?? "", "base64url");
  if (iv.length !== IV_BYTES || body.length < TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(purpose, secret), iv);
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    const plain = Buffer.concat([
      decipher.update(body.subarray(0, body.length - TAG_BYTES)),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}
