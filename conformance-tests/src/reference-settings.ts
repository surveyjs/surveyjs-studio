// The settings the conformance suite expects of its server, in one place: the in-process reference
// server (global-setup.ts) starts with them, CI writes them to an env file for `docker run`
// (`node --import tsx scripts/conformance/cli.ts reference-env`), and
// docs/customizing/porting.md lists them for a port. Pure: no side effects.

/** The account-deleted webhook secret: a synthetic test value (base64 of `my-surveys-conformance-webhook-key`). */
export const REFERENCE_WEBHOOK_SECRET = "whsec_bXktc3VydmV5cy1jb25mb3JtYW5jZS13ZWJob29rLWtleQ==";

export const REFERENCE_SETTINGS: Readonly<Record<string, string>> = {
  // The dev identity provider signs in as a user of the seed (see /__dev/sign-in).
  STORAGE_PROVIDER: "memory",
  IDENTITY_PROVIDER: "dev",
  MEMORY_SEED: "legacy-fixtures",
  LOG_LEVEL: "warn",
  // The suite signs in many times from one IP; the limit itself is tested in the server tests.
  SIGN_IN_RATE_LIMIT: "100000",
  // The suite reaches the server from loopback; the rate-limit test sends its own X-Forwarded-For.
  TRUST_PROXY: "127.0.0.1,::1",
  // The suite reads public surveys many times from one IP; the limits are tested in the server tests.
  PUBLIC_RATE_LIMIT: "300",
  PUBLIC_FILE_RATE_LIMIT: "10000",
  // Small, so the 413 and quota tests stay cheap (they read the limits from /config).
  LIMIT_MAX_DOCUMENT_BYTES: "262144",
  LIMIT_MAX_ASSET_BYTES_PER_SURVEY: "65536",
  LIMIT_MAX_FILE_BYTES: "65536",
  // The account-deleted webhook tests sign with the same secret.
  ACCOUNT_WEBHOOK_SECRET: REFERENCE_WEBHOOK_SECRET,
};

/** The settings plus the address the server listens on; sign-in redirects point at `PUBLIC_BASE_URL`. */
export function referenceEnv(port: number): Record<string, string> {
  return {
    ...REFERENCE_SETTINGS,
    HOST: "127.0.0.1",
    PORT: String(port),
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
  };
}
