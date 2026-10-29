import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Password hashes: argon2id through Node's built-in `crypto.argon2` (ADR 0026), stored as a PHC
 * string, `$argon2id$v=19$m=<KiB>,t=<passes>,p=<lanes>$<salt>$<hash>` (base64 without padding).
 * The parameters are read back from each hash, so a hash made with other ones still verifies.
 */

export interface HashParameters {
  /** KiB of memory; default 19,456 (19 MiB, the OWASP minimum for argon2id). */
  readonly memory: number;
  /** Passes over the memory; default 2. */
  readonly passes: number;
}

const DEFAULTS: HashParameters = { memory: 19_456, passes: 2 };
const PARALLELISM = 1;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

const derive = (
  password: string,
  salt: Buffer,
  {
    memory,
    passes,
    parallelism,
    tagLength,
  }: HashParameters & { parallelism: number; tagLength: number },
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      { message: password, nonce: salt, memory, passes, parallelism, tagLength },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });

const b64 = (bytes: Buffer): string => bytes.toString("base64").replace(/=+$/, "");

export async function hashPassword(
  password: string,
  parameters: Partial<HashParameters> = {},
): Promise<string> {
  const { memory, passes } = { ...DEFAULTS, ...parameters };
  const salt = randomBytes(SALT_BYTES);
  const tag = await derive(password, salt, {
    memory,
    passes,
    parallelism: PARALLELISM,
    tagLength: TAG_BYTES,
  });
  return `$argon2id$v=19$m=${String(memory)},t=${String(passes)},p=${String(PARALLELISM)}$${b64(salt)}$${b64(tag)}`;
}

const PHC =
  /^\$argon2id\$v=19\$m=(\d{1,7}),t=(\d{1,3}),p=(\d{1,3})\$([A-Za-z0-9+/]{16,})\$([A-Za-z0-9+/]{16,})$/;

/** Whether `password` matches `stored`; false for anything that is not an argon2id hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = PHC.exec(stored);
  if (!match) return false;
  const [, m, t, p, salt, hash] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const expected = Buffer.from(hash, "base64");
  let actual: Buffer;
  try {
    actual = await derive(password, Buffer.from(salt, "base64"), {
      memory: Number(m),
      passes: Number(t),
      parallelism: Number(p),
      tagLength: expected.length,
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A hash to verify against when an email is unknown, so the answer takes as long as for a known one. */
let dummy: Promise<string> | undefined;
export const dummyHash = (): Promise<string> =>
  (dummy ??= hashPassword(randomBytes(16).toString("hex")));
