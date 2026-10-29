// App variables that must not leak from the caller's environment into the e2e servers, the
// previews or the web build. Playwright merges webServer.env onto process.env and cannot unset
// keys, so everything is stripped first and the servers get only explicit values. Keep in sync with
// server/src/config.ts and conformance-tests/src/global-setup.ts.
export const appVariables = [
  "NODE_ENV",
  "HOST",
  "PORT",
  "LOG_LEVEL",
  "APP_EDITION",
  "APP_SHELL",
  "AUTH_METHODS",
  "SURVEYJS_LICENSE_KEY",
  "STORAGE_PROVIDER",
  "MEMORY_SEED",
  "DATABASE_URL",
  "SQLITE_PATH",
  "FILE_STORE",
  "FILES_PATH",
  "S3_BUCKET",
  "S3_REGION",
  "S3_ENDPOINT",
  "S3_FORCE_PATH_STYLE",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
  "PUBLIC_BASE_URL",
  "LIMIT_MAX_ASSET_BYTES_PER_SURVEY",
  "LIMIT_MAX_FILE_BYTES",
  "LIMIT_MAX_RESPONSE_BYTES",
  "LIMIT_MAX_DOCUMENT_BYTES",
  "API_DOCS",
  "LEGACY_SQL_CONNECTION_STRING",
  "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
  "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
  "IDENTITY_PROVIDER",
  "SESSION_SECRET",
  "SESSION_MAX_AGE_SECONDS",
  "OIDC_ISSUER_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_DISCOVERY",
  "OIDC_SCOPES",
  "SIGN_IN_RATE_LIMIT",
  "TRUST_PROXY",
  "PUBLIC_RATE_LIMIT",
  "PUBLIC_FILE_RATE_LIMIT",
  "ACCOUNT_NOTICES",
  "USER_DIRECTORY",
  "USER_API_URL",
  "USER_API_TOKEN",
  "ACCOUNT_WEBHOOK_SECRET",
  "SHELL_LINKS",
  "WEB_ROOT",
  "READ_ONLY",
  "REQUEST_TIMEOUT_SECONDS",
  "E2E_API_PROXY_TARGET",
];

/** Deletes every app variable (and every `VITE_*`) from `env`, in place. */
export function stripAppVariables(env) {
  for (const name of Object.keys(env)) {
    if (appVariables.includes(name) || name.startsWith("VITE_")) delete env[name];
  }
  return env;
}
