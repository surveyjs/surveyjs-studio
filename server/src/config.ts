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
  readonly storageProvider: "memory";
  readonly publicBaseUrl: string;
  readonly limits: {
    readonly maxAssetBytesPerSurvey: number;
    readonly maxFileBytes: number;
    readonly maxResponseBytes: number;
  };
  readonly apiDocs: boolean;
}

const positiveInt = z.coerce.number().int().positive();

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

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  APP_EDITION: z.enum(["hosted", "self-hosted"]).default("self-hosted"),
  APP_SHELL: z.string().min(1).default("surveyjs-site"),
  AUTH_METHODS: authMethods.default(["surveyjs"]),
  SURVEYJS_LICENSE_KEY: z.string().optional(),
  STORAGE_PROVIDER: z.enum(["memory"]).default("memory"),
  PUBLIC_BASE_URL: httpUrl.optional(),
  LIMIT_MAX_ASSET_BYTES_PER_SURVEY: positiveInt.default(52428800),
  LIMIT_MAX_FILE_BYTES: positiveInt.default(10485760),
  LIMIT_MAX_RESPONSE_BYTES: positiveInt.default(1048576),
  API_DOCS: z.enum(["true", "false"]).optional(),
});

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.safeParse(env);
  const problems: string[] = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${String(issue.path[0] ?? "environment")}: ${issue.message}`);
    }
  } else if (parsed.data.NODE_ENV === "production" && parsed.data.PUBLIC_BASE_URL === undefined) {
    problems.push("PUBLIC_BASE_URL: required when NODE_ENV=production");
  }
  if (!parsed.success || problems.length > 0) {
    throw new ConfigError(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
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
    publicBaseUrl: e.PUBLIC_BASE_URL ?? "http://localhost:3000",
    limits: Object.freeze({
      maxAssetBytesPerSurvey: e.LIMIT_MAX_ASSET_BYTES_PER_SURVEY,
      maxFileBytes: e.LIMIT_MAX_FILE_BYTES,
      maxResponseBytes: e.LIMIT_MAX_RESPONSE_BYTES,
    }),
    apiDocs: e.API_DOCS === undefined ? e.NODE_ENV !== "production" : e.API_DOCS === "true",
  });
}
