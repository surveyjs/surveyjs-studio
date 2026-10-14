import { z } from "zod";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const AUTH_METHODS = ["surveyjs", "password", "oidc"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly host: string;
  readonly port: number;
  readonly logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  readonly edition: "hosted" | "self-hosted";
  readonly shell: string;
  readonly authMethods: readonly AuthMethod[];
  readonly surveyjsLicenseKey: string | null;
  readonly storageProvider: "memory" | "azure-legacy";
  readonly memorySeed: "empty" | "legacy-fixtures";
  /** Set only when storageProvider is `azure-legacy`. Secrets: never log or echo these values. */
  readonly legacy: LegacyConfig | null;
  readonly publicBaseUrl: string;
  readonly limits: {
    readonly maxAssetBytesPerSurvey: number;
    readonly maxFileBytes: number;
    readonly maxResponseBytes: number;
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
  readonly accountNotices: AccountNotices;
  /** Optional account links merged over the shell's built-in ones. */
  readonly shellLinks: Readonly<Record<string, string>>;
}

export const ACCOUNT_NOTICES = [
  "none",
  "license-expired",
  "license-expires-soon",
  "surveyjs-licenses",
] as const;
export type AccountNotices = (typeof ACCOUNT_NOTICES)[number];

export interface OidcConfig {
  readonly issuerUrl: string;
  readonly clientId: string;
  /** Secret: never log or echo. */
  readonly clientSecret: string;
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
  STORAGE_PROVIDER: z.enum(["memory", "azure-legacy"]).default("memory"),
  MEMORY_SEED: z.enum(["empty", "legacy-fixtures"]).default("empty"),
  PUBLIC_BASE_URL: httpUrl.optional(),
  LIMIT_MAX_ASSET_BYTES_PER_SURVEY: positiveInt.default(52428800),
  LIMIT_MAX_FILE_BYTES: positiveInt.default(10485760),
  LIMIT_MAX_RESPONSE_BYTES: positiveInt.default(1048576),
  API_DOCS: z.enum(["true", "false"]).optional(),
  IDENTITY_PROVIDER: z.enum(["surveyjs-oidc", "dev"]).default("surveyjs-oidc"),
  // Plain strings (checked in loadConfig): a schema check here could echo the secret.
  SESSION_SECRET: z.string().optional(),
  SESSION_MAX_AGE_SECONDS: positiveInt.default(43200),
  OIDC_ISSUER_URL: httpUrl.optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_SCOPES: z.string().min(1).default("openid profile email"),
  SIGN_IN_RATE_LIMIT: positiveInt.default(30),
  ACCOUNT_NOTICES: z.enum(ACCOUNT_NOTICES).default("none"),
  SHELL_LINKS: shellLinks.optional(),
  // Plain strings: a schema check here could echo a value in its message.
  LEGACY_SQL_CONNECTION_STRING: z.string().optional(),
  LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: z.string().optional(),
  LEGACY_RESULTS_STORAGE_CONNECTION_STRING: z.string().optional(),
});

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
    if (env.STORAGE_PROVIDER !== undefined && env.STORAGE_PROVIDER !== "memory") {
      problems.push("IDENTITY_PROVIDER: dev requires STORAGE_PROVIDER=memory");
    }
  } else if (provider === "surveyjs-oidc") {
    for (const name of ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"]) {
      if (env[name] === undefined) {
        problems.push(`${name}: required when IDENTITY_PROVIDER=surveyjs-oidc`);
      }
    }
  }
  if (env.NODE_ENV === "production" && env.SESSION_SECRET === undefined) {
    problems.push("SESSION_SECRET: required when NODE_ENV=production");
  }
  return problems;
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
  if (env.SESSION_SECRET !== undefined && env.SESSION_SECRET.length < 32) {
    problems.push("SESSION_SECRET: must be at least 32 characters");
  }
  if (parsed.success && parsed.data.ACCOUNT_NOTICES === "surveyjs-licenses") {
    if (env.STORAGE_PROVIDER !== "azure-legacy") {
      problems.push("ACCOUNT_NOTICES: surveyjs-licenses requires STORAGE_PROVIDER=azure-legacy");
    }
  }
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
    publicBaseUrl: e.PUBLIC_BASE_URL ?? "http://localhost:3000",
    limits: Object.freeze({
      maxAssetBytesPerSurvey: e.LIMIT_MAX_ASSET_BYTES_PER_SURVEY,
      maxFileBytes: e.LIMIT_MAX_FILE_BYTES,
      maxResponseBytes: e.LIMIT_MAX_RESPONSE_BYTES,
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
            scopes: e.OIDC_SCOPES,
          })
        : null,
    signInRateLimitPerMinute: e.SIGN_IN_RATE_LIMIT,
    accountNotices: e.ACCOUNT_NOTICES,
    shellLinks: Object.freeze({ ...e.SHELL_LINKS }),
  });
}
