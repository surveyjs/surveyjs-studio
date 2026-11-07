import { isIP } from "node:net";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { isWebhookSecret } from "./accounts/webhook-secret.js";
import type { DatabaseTarget } from "./sql/database.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const STORAGE_PROVIDERS = ["memory", "azure-legacy", "sqlite", "postgres"] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

/** Providers whose users and other stores are still the memory ones (self-hosted track Steps 1–4). */
const SQL_PROVIDERS: readonly string[] = ["sqlite", "postgres"];

/** `FILE_STORE` and its settings. Secret (the S3 secret key): never log or echo. */
export type FilesConfig =
  | { readonly kind: "local"; readonly path: string }
  | {
      readonly kind: "s3";
      readonly bucket: string;
      readonly region: string;
      /** Without a trailing slash; null: AWS S3 itself. */
      readonly endpoint: string | null;
      readonly forcePathStyle: boolean;
      /** null: the AWS SDK's default credential chain. */
      readonly credentials: {
        readonly accessKeyId: string;
        readonly secretAccessKey: string;
      } | null;
    };

export const AUTH_METHODS = ["surveyjs", "password", "google", "github", "facebook"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

/** `USER_DIRECTORY` values; `local` is refused until the self-hosted track builds it (R8). */
export const USER_DIRECTORIES = ["memory", "surveyjs-sql", "surveyjs-api", "local"] as const;
export type UserDirectorySetting = Exclude<(typeof USER_DIRECTORIES)[number], "local">;

/** Sign-in methods that need the local user directory (R8). */
const LOCAL_DIRECTORY_METHODS: readonly string[] = ["password", "google", "github", "facebook"];

export interface UserApiConfig {
  /** `USER_API_URL` without a trailing slash. */
  readonly url: string;
  /** Secret: never log or echo. */
  readonly token: string;
}

export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly host: string;
  readonly port: number;
  readonly logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  readonly edition: "hosted" | "self-hosted";
  readonly shell: string;
  readonly authMethods: readonly AuthMethod[];
  readonly surveyjsLicenseKey: string | null;
  readonly storageProvider: StorageProvider;
  readonly memorySeed: "empty" | "legacy-fixtures";
  /** Set only when storageProvider is `azure-legacy`. Secrets: never log or echo these values. */
  readonly legacy: LegacyConfig | null;
  /** Set only when storageProvider is `sqlite` or `postgres`. Secret (the URL): never log or echo. */
  readonly database: DatabaseTarget | null;
  /** Where the SQL providers keep file bytes; null for the other providers (they keep their own). */
  readonly files: FilesConfig | null;
  readonly publicBaseUrl: string;
  readonly limits: {
    readonly maxAssetBytesPerSurvey: number;
    readonly maxFileBytes: number;
    readonly maxResponseBytes: number;
    /** Largest survey definition or theme body, in bytes (a per-route limit). */
    readonly maxDocumentBytes: number;
  };
  readonly apiDocs: boolean;
  readonly identityProvider: "surveyjs-oidc" | "dev";
  /** Secret: never log or echo. The dev constant when `SESSION_SECRET` is unset outside production. */
  readonly sessionSecret: string;
  /** True when `sessionSecret` is the built-in development constant; the server logs a warning. */
  readonly sessionSecretIsDevDefault: boolean;
  readonly sessionMaxAgeSeconds: number;
  /** Set only when `identityProvider` is `surveyjs-oidc` (and identity is not skipped). */
  readonly oidc: OidcConfig | null;
  readonly signInRateLimitPerMinute: number;
  /** Peers (IP addresses or CIDR ranges) whose X-Forwarded-For is believed; empty trusts nobody. */
  readonly trustProxy: readonly string[];
  /** Requests per client IP and minute for each of the three public operations. */
  readonly publicRateLimitPerMinute: number;
  /** Requests per client IP and minute for `downloadFile`. */
  readonly publicFileRateLimitPerMinute: number;
  readonly accountNotices: AccountNoticesSetting;
  /** `USER_DIRECTORY`, or its default for the storage provider (R7, R8). */
  readonly userDirectory: UserDirectorySetting;
  /** Set only when userDirectory is `surveyjs-api`. */
  readonly userApi: UserApiConfig | null;
  /** `ACCOUNT_WEBHOOK_SECRET` (`whsec_...`); null: the webhook answers 404. Secret: never log or echo. */
  readonly accountWebhookSecret: string | null;
  /** Optional account links merged over the shell's built-in ones. */
  readonly shellLinks: Readonly<Record<string, string>>;
  /** `WEB_ROOT`: the built web app the server also serves (ADR 0021); null serves the API only. */
  readonly webRoot: string | null;
  /** `READ_ONLY`: every write answers `503 read-only`; reads, sign-in and sign-out keep working. */
  readonly readOnly: boolean;
  /** `REQUEST_TIMEOUT_SECONDS` in milliseconds: the whole request, headers and body, must arrive within it. */
  readonly requestTimeoutMs: number;
}

export const ACCOUNT_NOTICES = [
  "none",
  "license-expired",
  "license-expires-soon",
  "surveyjs-licenses",
] as const;
export type AccountNoticesSetting = (typeof ACCOUNT_NOTICES)[number];

export const OIDC_DISCOVERY = ["oauth-authorization-server", "openid-configuration"] as const;

export interface OidcConfig {
  readonly issuerUrl: string;
  readonly clientId: string;
  /** Secret: never log or echo. */
  readonly clientSecret: string;
  /**
   * Which metadata the issuer publishes: RFC 8414 `oauth-authorization-server` (auth.surveyjs.io:
   * OAuth 2.0 with UserInfo, no ID token) or OpenID Connect `openid-configuration`.
   */
  readonly discovery: (typeof OIDC_DISCOVERY)[number];
  readonly scopes: string;
}

/** Fixed key for development and tests only; production requires `SESSION_SECRET`. */
export const DEV_SESSION_SECRET = "development-only-session-secret-do-not-use-in-production";

export interface LegacyConfig {
  readonly sqlConnectionString: string;
  readonly surveysStorageConnectionString: string;
  readonly resultsStorageConnectionString: string;
}

/** Connection strings of the legacy surveyjs.io stores, required by the azure-legacy provider. */
export const LEGACY_VARIABLES = [
  "LEGACY_SQL_CONNECTION_STRING",
  "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
  "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
] as const;

// Decimal digits only: rejects "1e3", "0x10", "-1", "1.5" which Number() would accept.
const decimalInt = z.string().regex(/^[0-9]+$/, "must be a decimal integer");
const positiveInt = decimalInt.transform(Number).pipe(z.number().int().positive());

const TRUST_PROXY_MESSAGE = "must be a comma-separated list of IP addresses or CIDR ranges";

function isTrustedPeer(item: string): boolean {
  const slash = item.indexOf("/");
  if (slash < 0) return isIP(item) !== 0;
  const version = isIP(item.slice(0, slash));
  const prefix = item.slice(slash + 1);
  return (
    version !== 0 && /^[0-9]{1,3}$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128)
  );
}

const trustProxy = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== ""),
  )
  .refine((items) => items.every(isTrustedPeer), TRUST_PROXY_MESSAGE);

const authMethods = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== ""),
  )
  .pipe(z.array(z.enum(AUTH_METHODS)).min(1));

const httpUrl = z
  .string()
  .refine((value) => URL.canParse(value) && /^https?:$/.test(new URL(value).protocol), {
    message: "must be an absolute http(s) URL",
  });

/**
 * The browser-visible origin. A base path is not supported in Phase 1 (the OIDC `redirect_uri`
 * and every redirect are built on the origin), so a path, query, hash or user info is refused.
 * Normalised to the origin, without a trailing slash.
 */
const publicBaseUrl = httpUrl
  .refine(
    (value) => {
      if (!URL.canParse(value)) return true; // reported by httpUrl
      const url = new URL(value);
      return url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
    },
    { message: "must be an origin only, such as https://surveys.example.com (no path)" },
  )
  .transform((value) => new URL(value).origin);

/** Parsed with a plain string so a bad value never appears in a message. */
const shellLinks = z.string().transform((value, ctx): Record<string, string> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "must be a JSON object" });
    return z.NEVER;
  }
  const isObject = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  const entries: [string, unknown][] = isObject
    ? Object.entries(parsed as Record<string, unknown>)
    : [];
  const valid =
    isObject &&
    entries.every(
      ([, url]) => typeof url === "string" && URL.canParse(url) && /^https?:\/\//.test(url),
    );
  if (!valid) {
    ctx.addIssue({ code: "custom", message: "must be a JSON object of absolute http(s) URLs" });
    return z.NEVER;
  }
  return Object.fromEntries(entries) as Record<string, string>;
});

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: decimalInt.transform(Number).pipe(z.number().int().min(0).max(65535)).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  APP_EDITION: z.enum(["hosted", "self-hosted"]).default("self-hosted"),
  APP_SHELL: z.string().min(1).default("surveyjs-site"),
  AUTH_METHODS: authMethods.default(["surveyjs"]),
  SURVEYJS_LICENSE_KEY: z.string().optional(),
  STORAGE_PROVIDER: z.enum(STORAGE_PROVIDERS).default("memory"),
  MEMORY_SEED: z.enum(["empty", "legacy-fixtures"]).default("empty"),
  // Plain string (checked in loadConfig): a schema check here could echo the password.
  DATABASE_URL: z.string().optional(),
  SQLITE_PATH: z.string().min(1).default("/data/surveyjs-studio.db"),
  FILE_STORE: z.enum(["local", "s3"]).optional(),
  FILES_PATH: z.string().min(1).default("/data/files"),
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ENDPOINT: httpUrl.optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"], { error: "must be true or false" })
    .default("false"),
  // Plain strings (checked in loadConfig): a schema check here could echo the secret.
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  PUBLIC_BASE_URL: publicBaseUrl.optional(),
  LIMIT_MAX_ASSET_BYTES_PER_SURVEY: positiveInt.default(52428800),
  LIMIT_MAX_FILE_BYTES: positiveInt.default(10485760),
  LIMIT_MAX_RESPONSE_BYTES: positiveInt.default(1048576),
  LIMIT_MAX_DOCUMENT_BYTES: positiveInt.default(30000000),
  API_DOCS: z.enum(["true", "false"]).optional(),
  IDENTITY_PROVIDER: z.enum(["surveyjs-oidc", "dev"]).default("surveyjs-oidc"),
  // Plain strings (checked in loadConfig): a schema check here could echo the secret.
  SESSION_SECRET: z.string().optional(),
  SESSION_MAX_AGE_SECONDS: positiveInt.default(43200),
  OIDC_ISSUER_URL: httpUrl.optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_DISCOVERY: z.enum(OIDC_DISCOVERY).default("oauth-authorization-server"),
  // Default by OIDC_DISCOVERY: auth.surveyjs.io advertises only profile and email.
  OIDC_SCOPES: z.string().min(1).optional(),
  SIGN_IN_RATE_LIMIT: positiveInt.default(30),
  TRUST_PROXY: trustProxy.default([]),
  PUBLIC_RATE_LIMIT: positiveInt.default(60),
  PUBLIC_FILE_RATE_LIMIT: positiveInt.default(600),
  ACCOUNT_NOTICES: z.enum(ACCOUNT_NOTICES).default("none"),
  USER_DIRECTORY: z.enum(USER_DIRECTORIES).optional(),
  USER_API_URL: httpUrl.optional(),
  // Plain strings (checked in loadConfig): a schema check here could echo the secret.
  USER_API_TOKEN: z.string().optional(),
  ACCOUNT_WEBHOOK_SECRET: z.string().optional(),
  SHELL_LINKS: shellLinks.optional(),
  // Checked for an index.html at start-up (registerWebApp), not here.
  WEB_ROOT: z.string().refine(isAbsolute, "must be an absolute path").optional(),
  READ_ONLY: z.enum(["true", "false"], { error: "must be true or false" }).optional(),
  REQUEST_TIMEOUT_SECONDS: positiveInt.default(300),
  // Plain strings: a schema check here could echo a value in its message.
  LEGACY_SQL_CONNECTION_STRING: z.string().optional(),
  LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: z.string().optional(),
  LEGACY_RESULTS_STORAGE_CONNECTION_STRING: z.string().optional(),
});

/** Every variable the server reads, in schema order (the drift test compares the copies with it). */
export const ENV_VARIABLES: readonly string[] = Object.freeze(Object.keys(envSchema.shape));

/** Empty and whitespace-only values count as unset (e.g. `PORT=` in a .env file or compose file). */
function withoutBlanks(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).map(([name, value]) => [name, value?.trim() === "" ? undefined : value]),
  );
}

export interface LoadConfigOptions {
  /**
   * Skips the identity cross-field rules (dev refusal, OIDC trio, production session secret) for
   * tools that never serve HTTP, such as the inspector CLI. The values are still parsed.
   */
  readonly skipIdentityRules?: boolean;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True for an absolute URL whose host is `localhost`, `127.0.0.1` or `[::1]`. */
function isLoopback(url: string): boolean {
  return URL.canParse(url) && LOOPBACK_HOSTS.has(new URL(url).hostname);
}

/**
 * True when `PUBLIC_BASE_URL` is https or not on a loopback host: other people may reach the
 * server, so the public development session secret is refused even if `NODE_ENV` was forgotten.
 */
function isServedToOthers(env: Record<string, string | undefined>): boolean {
  const base = env.PUBLIC_BASE_URL;
  if (base === undefined || !URL.canParse(base)) return false; // default, or reported elsewhere
  return new URL(base).protocol === "https:" || !isLoopback(base);
}

/** The items of a comma-separated value, trimmed, blanks dropped, each once. */
function csvItems(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== ""),
    ),
  ];
}

/**
 * R8: the user directory, the sign-in methods and the account settings. Runs for every caller (the
 * CLIs need a working directory too). A default USER_DIRECTORY always fits its storage provider, so
 * the storage rules apply to an explicit value only.
 */
function accountProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  const storage = env.STORAGE_PROVIDER ?? "memory";
  const directory = env.USER_DIRECTORY;
  if (directory === "memory" && storage !== "memory" && !SQL_PROVIDERS.includes(storage)) {
    problems.push("USER_DIRECTORY: memory requires STORAGE_PROVIDER=memory, sqlite or postgres");
  }
  if (directory === "surveyjs-sql" && storage !== "azure-legacy") {
    problems.push("USER_DIRECTORY: surveyjs-sql requires STORAGE_PROVIDER=azure-legacy");
  }
  if (directory === "local") {
    problems.push("USER_DIRECTORY: local is not available yet (self-hosted track)");
  }
  if (directory === "surveyjs-api") {
    for (const name of ["USER_API_URL", "USER_API_TOKEN"]) {
      if (env[name] === undefined) {
        problems.push(`${name}: required when USER_DIRECTORY=surveyjs-api`);
      }
    }
    const url = env.USER_API_URL;
    if (
      url !== undefined &&
      URL.canParse(url) &&
      new URL(url).protocol === "http:" &&
      !isLoopback(url)
    ) {
      problems.push("USER_API_URL: must be https unless its host is localhost, 127.0.0.1 or [::1]");
    }
  }
  for (const method of csvItems(env.AUTH_METHODS)) {
    if (LOCAL_DIRECTORY_METHODS.includes(method)) {
      problems.push(
        `AUTH_METHODS: ${method} requires USER_DIRECTORY=local, which is not available yet (self-hosted track)`,
      );
    }
  }
  const effective = directory ?? (storage === "azure-legacy" ? "surveyjs-sql" : "memory");
  if (
    env.ACCOUNT_NOTICES === "surveyjs-licenses" &&
    effective !== "surveyjs-sql" &&
    effective !== "surveyjs-api"
  ) {
    problems.push(
      "ACCOUNT_NOTICES: surveyjs-licenses requires USER_DIRECTORY=surveyjs-sql or surveyjs-api",
    );
  }
  const secret = env.ACCOUNT_WEBHOOK_SECRET;
  if (secret !== undefined && !isWebhookSecret(secret)) {
    problems.push(
      "ACCOUNT_WEBHOOK_SECRET: must be whsec_ followed by the base64 of at least 24 bytes",
    );
  }
  return problems;
}

/** The SQL providers' settings (self-hosted track). Never echoes DATABASE_URL, which holds a password. */
function databaseProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  const storage = env.STORAGE_PROVIDER;
  if (storage === undefined || !SQL_PROVIDERS.includes(storage)) return problems;
  if (env.NODE_ENV === "production") {
    problems.push(
      `STORAGE_PROVIDER: ${storage} is not allowed when NODE_ENV=production until every store is on SQL (self-hosted track)`,
    );
  }
  if (storage === "postgres") {
    const url = env.DATABASE_URL;
    if (url === undefined) {
      problems.push("DATABASE_URL: required when STORAGE_PROVIDER=postgres");
    } else if (
      !URL.canParse(url) ||
      !["postgres:", "postgresql:"].includes(new URL(url).protocol)
    ) {
      problems.push("DATABASE_URL: must be a postgres:// or postgresql:// URL");
    }
  }
  return problems;
}

/** FILE_STORE and the S3 settings. Never echoes S3_SECRET_ACCESS_KEY. */
function fileProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  const storage = env.STORAGE_PROVIDER ?? "memory";
  if (env.FILE_STORE !== undefined && !SQL_PROVIDERS.includes(storage)) {
    problems.push("FILE_STORE: requires STORAGE_PROVIDER=sqlite or postgres");
  }
  if (env.FILE_STORE !== "s3") return problems;
  if (env.S3_BUCKET === undefined) problems.push("S3_BUCKET: required when FILE_STORE=s3");
  const both = "(set both, or neither for the AWS default credentials)";
  if (env.S3_ACCESS_KEY_ID !== undefined && env.S3_SECRET_ACCESS_KEY === undefined) {
    problems.push(`S3_SECRET_ACCESS_KEY: required with S3_ACCESS_KEY_ID ${both}`);
  }
  if (env.S3_SECRET_ACCESS_KEY !== undefined && env.S3_ACCESS_KEY_ID === undefined) {
    problems.push(`S3_ACCESS_KEY_ID: required with S3_SECRET_ACCESS_KEY ${both}`);
  }
  // Plain http only to a server on this machine (the local S3 server); never in transit.
  const endpoint = env.S3_ENDPOINT;
  if (
    endpoint !== undefined &&
    URL.canParse(endpoint) &&
    new URL(endpoint).protocol === "http:" &&
    !isLoopback(endpoint)
  ) {
    problems.push("S3_ENDPOINT: must be https unless its host is localhost, 127.0.0.1 or [::1]");
  }
  return problems;
}

function identityProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  const provider = env.IDENTITY_PROVIDER ?? "surveyjs-oidc";
  if (provider === "dev") {
    if (env.NODE_ENV === "production") {
      problems.push("IDENTITY_PROVIDER: dev is not allowed when NODE_ENV=production");
    }
    if (env.APP_EDITION === "hosted") {
      problems.push("IDENTITY_PROVIDER: dev is not allowed when APP_EDITION=hosted");
    }
    const storage = env.STORAGE_PROVIDER ?? "memory";
    if (storage !== "memory" && !SQL_PROVIDERS.includes(storage)) {
      problems.push("IDENTITY_PROVIDER: dev requires STORAGE_PROVIDER=memory, sqlite or postgres");
    }
  } else if (provider === "surveyjs-oidc") {
    for (const name of ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"]) {
      if (env[name] === undefined) {
        problems.push(`${name}: required when IDENTITY_PROVIDER=surveyjs-oidc`);
      }
    }
    // Plain http only to an issuer on this machine (the mock OIDC server); never in transit.
    const issuer = env.OIDC_ISSUER_URL;
    if (issuer !== undefined && URL.canParse(issuer) && new URL(issuer).protocol === "http:") {
      if (!isLoopback(issuer)) {
        problems.push(
          "OIDC_ISSUER_URL: must be https unless its host is localhost, 127.0.0.1 or [::1]",
        );
      }
    }
  }
  if (env.SESSION_SECRET === undefined) {
    if (env.NODE_ENV === "production") {
      problems.push("SESSION_SECRET: required when NODE_ENV=production");
    } else if (isServedToOthers(env)) {
      problems.push(
        "SESSION_SECRET: required when PUBLIC_BASE_URL is https or not on localhost, 127.0.0.1 or [::1]",
      );
    }
  }
  return problems;
}

/** Where the SQL providers keep their data; null for the other providers. */
function databaseOf(e: z.infer<typeof envSchema>): DatabaseTarget | null {
  if (e.STORAGE_PROVIDER === "sqlite") {
    return Object.freeze({ dialect: "sqlite", path: resolve(e.SQLITE_PATH) });
  }
  if (e.STORAGE_PROVIDER === "postgres") {
    return Object.freeze({ dialect: "postgres", url: e.DATABASE_URL ?? "" });
  }
  return null;
}

/** Where the SQL providers keep file bytes; null for the other providers. */
function filesOf(e: z.infer<typeof envSchema>): FilesConfig | null {
  if (e.STORAGE_PROVIDER !== "sqlite" && e.STORAGE_PROVIDER !== "postgres") return null;
  if (e.FILE_STORE !== "s3") return Object.freeze({ kind: "local", path: resolve(e.FILES_PATH) });
  return Object.freeze({
    kind: "s3",
    bucket: e.S3_BUCKET ?? "",
    region: e.S3_REGION,
    endpoint: e.S3_ENDPOINT?.replace(/[/]+$/, "") ?? null,
    forcePathStyle: e.S3_FORCE_PATH_STYLE === "true",
    credentials:
      e.S3_ACCESS_KEY_ID !== undefined && e.S3_SECRET_ACCESS_KEY !== undefined
        ? Object.freeze({
            accessKeyId: e.S3_ACCESS_KEY_ID,
            secretAccessKey: e.S3_SECRET_ACCESS_KEY,
          })
        : null,
  });
}

export function loadConfig(
  rawEnv: Record<string, string | undefined>,
  options: LoadConfigOptions = {},
): AppConfig {
  const env = withoutBlanks(rawEnv);
  const parsed = envSchema.safeParse(env);
  const problems: string[] = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${String(issue.path[0] ?? "environment")}: ${issue.message}`);
    }
  }
  const productionWithoutUrl = env.NODE_ENV === "production" && env.PUBLIC_BASE_URL === undefined;
  if (productionWithoutUrl && !problems.some((p) => p.startsWith("PUBLIC_BASE_URL:"))) {
    problems.push("PUBLIC_BASE_URL: required when NODE_ENV=production");
  }
  if (env.STORAGE_PROVIDER === "azure-legacy") {
    for (const name of LEGACY_VARIABLES) {
      if (env[name] === undefined) {
        problems.push(`${name}: required when STORAGE_PROVIDER=azure-legacy`);
      }
    }
  }
  problems.push(...databaseProblems(env));
  problems.push(...fileProblems(env));
  if (env.SESSION_SECRET !== undefined && env.SESSION_SECRET.length < 32) {
    problems.push("SESSION_SECRET: must be at least 32 characters");
  }
  problems.push(...accountProblems(env));
  if (options.skipIdentityRules !== true) problems.push(...identityProblems(env));
  if (!parsed.success || problems.length > 0) {
    const lines = problems.map((p) => `  - ${p}`).join("\n");
    throw new ConfigError(`Invalid configuration:\n${lines}`);
  }
  const e = parsed.data;
  return Object.freeze({
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    edition: e.APP_EDITION,
    shell: e.APP_SHELL,
    authMethods: Object.freeze([...e.AUTH_METHODS]),
    surveyjsLicenseKey: e.SURVEYJS_LICENSE_KEY ?? null,
    storageProvider: e.STORAGE_PROVIDER,
    memorySeed: e.MEMORY_SEED,
    legacy:
      e.STORAGE_PROVIDER === "azure-legacy"
        ? Object.freeze({
            sqlConnectionString: e.LEGACY_SQL_CONNECTION_STRING ?? "",
            surveysStorageConnectionString: e.LEGACY_SURVEYS_STORAGE_CONNECTION_STRING ?? "",
            resultsStorageConnectionString: e.LEGACY_RESULTS_STORAGE_CONNECTION_STRING ?? "",
          })
        : null,
    database: databaseOf(e),
    files: filesOf(e),
    publicBaseUrl: e.PUBLIC_BASE_URL ?? "http://localhost:3000",
    limits: Object.freeze({
      maxAssetBytesPerSurvey: e.LIMIT_MAX_ASSET_BYTES_PER_SURVEY,
      maxFileBytes: e.LIMIT_MAX_FILE_BYTES,
      maxResponseBytes: e.LIMIT_MAX_RESPONSE_BYTES,
      maxDocumentBytes: e.LIMIT_MAX_DOCUMENT_BYTES,
    }),
    apiDocs: e.API_DOCS === undefined ? e.NODE_ENV !== "production" : e.API_DOCS === "true",
    identityProvider: e.IDENTITY_PROVIDER,
    sessionSecret: e.SESSION_SECRET ?? DEV_SESSION_SECRET,
    sessionSecretIsDevDefault: e.SESSION_SECRET === undefined,
    sessionMaxAgeSeconds: e.SESSION_MAX_AGE_SECONDS,
    oidc:
      e.IDENTITY_PROVIDER === "surveyjs-oidc" &&
      e.OIDC_ISSUER_URL !== undefined &&
      e.OIDC_CLIENT_ID !== undefined &&
      e.OIDC_CLIENT_SECRET !== undefined
        ? Object.freeze({
            issuerUrl: e.OIDC_ISSUER_URL,
            clientId: e.OIDC_CLIENT_ID,
            clientSecret: e.OIDC_CLIENT_SECRET,
            discovery: e.OIDC_DISCOVERY,
            scopes:
              e.OIDC_SCOPES ??
              (e.OIDC_DISCOVERY === "openid-configuration"
                ? "openid profile email"
                : "profile email"),
          })
        : null,
    signInRateLimitPerMinute: e.SIGN_IN_RATE_LIMIT,
    trustProxy: Object.freeze([...e.TRUST_PROXY]),
    publicRateLimitPerMinute: e.PUBLIC_RATE_LIMIT,
    publicFileRateLimitPerMinute: e.PUBLIC_FILE_RATE_LIMIT,
    accountNotices: e.ACCOUNT_NOTICES,
    // `local` never gets here: accountProblems refuses it.
    userDirectory: (e.USER_DIRECTORY ??
      (e.STORAGE_PROVIDER === "azure-legacy" ? "surveyjs-sql" : "memory")) as UserDirectorySetting,
    userApi:
      e.USER_DIRECTORY === "surveyjs-api" &&
      e.USER_API_URL !== undefined &&
      e.USER_API_TOKEN !== undefined
        ? Object.freeze({ url: e.USER_API_URL.replace(/\/+$/, ""), token: e.USER_API_TOKEN })
        : null,
    accountWebhookSecret: e.ACCOUNT_WEBHOOK_SECRET ?? null,
    shellLinks: Object.freeze({ ...e.SHELL_LINKS }),
    webRoot: e.WEB_ROOT ?? null,
    readOnly: e.READ_ONLY === "true",
    requestTimeoutMs: e.REQUEST_TIMEOUT_SECONDS * 1000,
  });
}
