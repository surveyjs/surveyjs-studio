import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, DEV_SESSION_SECRET, loadConfig as load } from "./config.js";

/** Identity settings every non-identity test needs; each test overrides what it exercises. */
const identity = { IDENTITY_PROVIDER: "dev" };
const oidc = {
  OIDC_ISSUER_URL: "https://auth.example.com",
  OIDC_CLIENT_ID: "client-1",
  OIDC_CLIENT_SECRET: "oidc-Secret-Value-77",
};
const SESSION_SECRET = "0123456789abcdef0123456789abcdef";
const WEBHOOK_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const api = {
  USER_DIRECTORY: "surveyjs-api",
  USER_API_URL: "https://users.example.com",
  USER_API_TOKEN: "token-Value-31",
};

function loadConfig(env: Record<string, string | undefined>) {
  return load({ ...identity, ...env });
}

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).message;
  }
  throw new Error("expected a ConfigError");
}

describe("loadConfig", () => {
  it("loads defaults from an empty environment", () => {
    const config = loadConfig({});
    expect(config).toEqual({
      nodeEnv: "development",
      host: "127.0.0.1",
      port: 3000,
      logLevel: "info",
      edition: "self-hosted",
      shell: "surveyjs-site",
      authMethods: ["surveyjs"],
      surveyjsLicenseKey: null,
      branding: {
        name: "My Surveys",
        logoUrl: null,
        accentColor: "#19b394",
        termsUrl: null,
        privacyUrl: null,
        poweredBy: true,
      },
      features: { embed: true, apiDocs: true, apiTokens: true },
      storageProvider: "memory",
      memorySeed: "empty",
      legacy: null,
      database: null,
      files: null,
      bootstrapAdmin: null,
      publicBaseUrl: "http://localhost:3000",
      limits: {
        maxAssetBytesPerSurvey: 52428800,
        maxFileBytes: 10485760,
        maxResponseBytes: 1048576,
        maxDocumentBytes: 30000000,
      },
      apiDocs: true,
      identityProvider: "dev",
      sessionSecret: DEV_SESSION_SECRET,
      sessionSecretIsDevDefault: true,
      sessionMaxAgeSeconds: 43200,
      oidc: null,
      signInRateLimitPerMinute: 30,
      trustProxy: [],
      publicRateLimitPerMinute: 60,
      publicFileRateLimitPerMinute: 600,
      accountNotices: "none",
      userDirectory: "memory",
      userApi: null,
      accountWebhookSecret: null,
      shellLinks: {},
      webRoot: null,
      oauthClients: { google: null, github: null, facebook: null },
      joinPolicy: { signUpDomains: [], openSignUp: false },
      oauthStubUrl: null,
      readOnly: false,
      requestTimeoutMs: 300_000,
    });
  });

  it("returns a frozen config", () => {
    expect(Object.isFrozen(loadConfig({}))).toBe(true);
  });

  it("reads every variable", () => {
    const config = load({
      ...oidc,
      SESSION_SECRET,
      NODE_ENV: "production",
      HOST: "0.0.0.0",
      PORT: "0",
      LOG_LEVEL: "debug",
      APP_EDITION: "hosted",
      APP_SHELL: "acme",
      AUTH_METHODS: " surveyjs ",
      USER_DIRECTORY: "surveyjs-api",
      USER_API_URL: "https://users.example.com/api/",
      USER_API_TOKEN: "token-Value-31",
      ACCOUNT_WEBHOOK_SECRET: WEBHOOK_SECRET,
      SURVEYJS_LICENSE_KEY: "key-1",
      STORAGE_PROVIDER: "memory",
      MEMORY_SEED: "legacy-fixtures",
      PUBLIC_BASE_URL: "https://surveys.example.com",
      LIMIT_MAX_ASSET_BYTES_PER_SURVEY: "10",
      LIMIT_MAX_FILE_BYTES: "20",
      LIMIT_MAX_RESPONSE_BYTES: "30",
      LIMIT_MAX_DOCUMENT_BYTES: "40",
      // Not API_DOCS: the docs are shown only in the surveyjs-site shell (config-branding.test.ts).
    });
    expect(config).toMatchObject({
      nodeEnv: "production",
      host: "0.0.0.0",
      port: 0,
      logLevel: "debug",
      edition: "hosted",
      shell: "acme",
      authMethods: ["surveyjs"],
      userDirectory: "surveyjs-api",
      userApi: { url: "https://users.example.com/api", token: "token-Value-31" },
      accountWebhookSecret: WEBHOOK_SECRET,
      surveyjsLicenseKey: "key-1",
      memorySeed: "legacy-fixtures",
      publicBaseUrl: "https://surveys.example.com",
      limits: {
        maxAssetBytesPerSurvey: 10,
        maxFileBytes: 20,
        maxResponseBytes: 30,
        maxDocumentBytes: 40,
      },
      apiDocs: false,
    });
  });

  it("disables API docs by default in production only", () => {
    expect(
      load({
        ...oidc,
        SESSION_SECRET,
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "https://a.example",
      }).apiDocs,
    ).toBe(false);
    expect(loadConfig({ NODE_ENV: "test" }).apiDocs).toBe(true);
    expect(loadConfig({ NODE_ENV: "test", API_DOCS: "false" }).apiDocs).toBe(false);
  });

  it.each([
    ["NODE_ENV", "staging"],
    ["PORT", "65536"],
    ["PORT", "-1"],
    ["PORT", "3000.5"],
    ["PORT", "abc"],
    ["LOG_LEVEL", "loud"],
    ["APP_EDITION", "cloud"],
    ["AUTH_METHODS", "magic"],
    ["AUTH_METHODS", ","],
    ["AUTH_METHODS", "oidc"],
    ["USER_DIRECTORY", "ldap"],
    ["USER_API_URL", "not a url"],
    ["STORAGE_PROVIDER", "postgres"],
    ["MEMORY_SEED", "demo"],
    ["PUBLIC_BASE_URL", "not a url"],
    ["PUBLIC_BASE_URL", "ftp://example.com"],
    ["LIMIT_MAX_ASSET_BYTES_PER_SURVEY", "0"],
    ["LIMIT_MAX_FILE_BYTES", "-5"],
    ["LIMIT_MAX_RESPONSE_BYTES", "1.5"],
    ["LIMIT_MAX_DOCUMENT_BYTES", "0"],
    ["API_DOCS", "yes"],
  ])("rejects %s=%j and names the variable", (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(ConfigError);
    expect(() => loadConfig({ [name]: value })).toThrow(name);
  });

  it.each(["https://a.example/my-surveys", "https://a.example/?x=1", "https://a.example/#top"])(
    "rejects PUBLIC_BASE_URL=%s: a base path is not supported",
    (value) => {
      expect(messageOf(() => loadConfig({ PUBLIC_BASE_URL: value }))).toContain(
        "PUBLIC_BASE_URL: must be an origin only",
      );
    },
  );

  it("keeps PUBLIC_BASE_URL as an origin, without a trailing slash", () => {
    expect(
      loadConfig({ PUBLIC_BASE_URL: "https://a.example/", SESSION_SECRET }).publicBaseUrl,
    ).toBe("https://a.example");
    expect(loadConfig({ PUBLIC_BASE_URL: "HTTP://LOCALHOST:5173" }).publicBaseUrl).toBe(
      "http://localhost:5173",
    );
  });

  it("requires PUBLIC_BASE_URL in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/PUBLIC_BASE_URL/);
  });

  it("reports the production PUBLIC_BASE_URL requirement together with other problems", () => {
    const run = () => loadConfig({ NODE_ENV: "production", PORT: "99999" });
    expect(run).toThrow(/PORT/);
    expect(run).toThrow(/PUBLIC_BASE_URL/);
  });

  it("reports all problems in one error", () => {
    let error: unknown;
    try {
      loadConfig({
        PORT: "99999",
        APP_EDITION: "x",
        LIMIT_MAX_FILE_BYTES: "0",
        AUTH_METHODS: "nope",
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as ConfigError).message;
    for (const name of ["PORT", "APP_EDITION", "LIMIT_MAX_FILE_BYTES", "AUTH_METHODS"]) {
      expect(message).toContain(name);
    }
  });

  describe("azure-legacy storage provider", () => {
    const SECRET = "Password=Very-Secret-Value-42";
    const legacyEnv = {
      ...oidc,
      IDENTITY_PROVIDER: "surveyjs-oidc",
      STORAGE_PROVIDER: "azure-legacy",
      LEGACY_SQL_CONNECTION_STRING: `Server=sql.example.net;${SECRET}`,
      LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: `AccountName=surveys;AccountKey=${SECRET}`,
      LEGACY_RESULTS_STORAGE_CONNECTION_STRING: `AccountName=results;AccountKey=${SECRET}`,
    };

    it("reads the three connection strings", () => {
      const config = loadConfig(legacyEnv);
      expect(config.storageProvider).toBe("azure-legacy");
      expect(config.legacy).toEqual({
        sqlConnectionString: legacyEnv.LEGACY_SQL_CONNECTION_STRING,
        surveysStorageConnectionString: legacyEnv.LEGACY_SURVEYS_STORAGE_CONNECTION_STRING,
        resultsStorageConnectionString: legacyEnv.LEGACY_RESULTS_STORAGE_CONNECTION_STRING,
      });
      expect(Object.isFrozen(config.legacy)).toBe(true);
    });

    it.each([
      "LEGACY_SQL_CONNECTION_STRING",
      "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
      "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
    ])("reports a missing or blank %s without echoing any value", (name) => {
      for (const value of [undefined, "", "   "]) {
        const message = messageOf(() => loadConfig({ ...legacyEnv, [name]: value }));
        expect(message).toContain(`${name}: required when STORAGE_PROVIDER=azure-legacy`);
        expect(message).not.toContain("Very-Secret-Value-42");
        expect(message).not.toContain("example.net");
      }
    });

    it("reports every missing connection string in one error", () => {
      const message = messageOf(() => loadConfig({ STORAGE_PROVIDER: "azure-legacy" }));
      for (const name of [
        "LEGACY_SQL_CONNECTION_STRING",
        "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
        "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
      ]) {
        expect(message).toContain(name);
      }
    });

    it("never echoes connection strings next to other problems", () => {
      const message = messageOf(() => loadConfig({ ...legacyEnv, PORT: "99999" }));
      expect(message).toContain("PORT");
      expect(message).not.toContain("Very-Secret-Value-42");
    });

    it("leaves legacy null for the memory provider, even when the variables are set", () => {
      expect(loadConfig({ ...legacyEnv, STORAGE_PROVIDER: "memory" }).legacy).toBeNull();
      expect(loadConfig({ ...legacyEnv, STORAGE_PROVIDER: undefined }).legacy).toBeNull();
    });
  });

  describe("SQL storage providers", () => {
    const URL_SECRET = "Pg-Secret-Value-55";
    const DATABASE_URL = `postgres://studio:${URL_SECRET}@db.example.net:5432/studio`;

    it("puts SQLite at /data/surveyjs-studio.db unless SQLITE_PATH says otherwise", () => {
      expect(loadConfig({ STORAGE_PROVIDER: "sqlite" })).toMatchObject({
        storageProvider: "sqlite",
        database: { dialect: "sqlite", path: resolve("/data/surveyjs-studio.db") },
      });
      expect(
        loadConfig({ STORAGE_PROVIDER: "sqlite", SQLITE_PATH: ".data/studio.db" }).database,
      ).toEqual({ dialect: "sqlite", path: resolve(".data/studio.db") });
    });

    it("reads DATABASE_URL for PostgreSQL", () => {
      const config = loadConfig({ STORAGE_PROVIDER: "postgres", DATABASE_URL });
      expect(config.database).toEqual({ dialect: "postgres", url: DATABASE_URL });
      expect(Object.isFrozen(config.database)).toBe(true);
      expect(
        loadConfig({ STORAGE_PROVIDER: "postgres", DATABASE_URL: "postgresql://h/d" }).database,
      ).toEqual({ dialect: "postgres", url: "postgresql://h/d" });
    });

    it("requires a postgres URL in DATABASE_URL, without echoing it", () => {
      expect(messageOf(() => loadConfig({ STORAGE_PROVIDER: "postgres" }))).toContain(
        "  - DATABASE_URL: required when STORAGE_PROVIDER=postgres",
      );
      for (const url of [`mysql://u:${URL_SECRET}@h/d`, `not a url ${URL_SECRET}`]) {
        const message = messageOf(() =>
          loadConfig({ STORAGE_PROVIDER: "postgres", DATABASE_URL: url }),
        );
        expect(message).toContain("  - DATABASE_URL: must be a postgres:// or postgresql:// URL");
        expect(message).not.toContain(URL_SECRET);
      }
    });

    it("never echoes DATABASE_URL next to other problems", () => {
      const message = messageOf(() =>
        loadConfig({ STORAGE_PROVIDER: "postgres", DATABASE_URL, PORT: "99999" }),
      );
      expect(message).toContain("PORT");
      expect(message).not.toContain(URL_SECRET);
    });

    it("leaves database null for the other providers", () => {
      expect(loadConfig({ DATABASE_URL, SQLITE_PATH: "/x.db" }).database).toBeNull();
    });

    it.each(["sqlite", "postgres"])(
      "uses the memory directory and allows the dev sign-in with %s (until local accounts)",
      (provider) => {
        const config = loadConfig({ STORAGE_PROVIDER: provider, DATABASE_URL });
        expect(config.userDirectory).toBe("memory");
        expect(config.identityProvider).toBe("dev");
        expect(
          loadConfig({ STORAGE_PROVIDER: provider, DATABASE_URL, USER_DIRECTORY: "memory" })
            .userDirectory,
        ).toBe("memory");
      },
    );

    const production = {
      ...oidc,
      SESSION_SECRET,
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://surveys.example.com",
    };

    it.each(["sqlite", "postgres"])(
      "refuses %s with the memory user directory in production",
      (provider) => {
        const message = messageOf(() =>
          load({ ...production, STORAGE_PROVIDER: provider, DATABASE_URL }),
        );
        expect(message).toContain(
          `  - USER_DIRECTORY: memory is not allowed when NODE_ENV=production (STORAGE_PROVIDER=${provider} keeps users in memory); use local`,
        );
      },
    );

    it.each(["sqlite", "postgres"])(
      "allows %s with the local user directory in production",
      (provider) => {
        const config = load({
          ...production,
          STORAGE_PROVIDER: provider,
          DATABASE_URL,
          USER_DIRECTORY: "local",
          AUTH_METHODS: "password",
        });
        expect(config).toMatchObject({ storageProvider: provider, userDirectory: "local" });
      },
    );
  });

  describe("local accounts", () => {
    const ADMIN_SECRET = "Admin-Secret-Value-66";
    const local = { STORAGE_PROVIDER: "sqlite", USER_DIRECTORY: "local", AUTH_METHODS: "password" };

    it("signs in with passwords alone: no OIDC settings needed", () => {
      const config = load(local);
      expect(config).toMatchObject({
        userDirectory: "local",
        authMethods: ["password"],
        oidc: null,
        bootstrapAdmin: null,
      });
    });

    it("still needs the OIDC settings when surveyjs is a sign-in method too", () => {
      expect(messageOf(() => load({ ...local, AUTH_METHODS: "password,surveyjs" }))).toContain(
        "  - OIDC_ISSUER_URL: required when IDENTITY_PROVIDER=surveyjs-oidc",
      );
    });

    it("works with the memory storage provider too", () => {
      expect(load({ ...local, STORAGE_PROVIDER: "memory" }).userDirectory).toBe("local");
    });

    it("accepts any ordinary email address as the first admin's", () => {
      for (const email of ["sam.sanders@sub.example.co.uk", "s+tag@example.com"]) {
        expect(
          load({ ...local, ADMIN_EMAIL: email, ADMIN_PASSWORD: ADMIN_SECRET }).bootstrapAdmin
            ?.email,
        ).toBe(email);
      }
    });

    it("reads the first admin, with the email lower-cased", () => {
      expect(
        load({ ...local, ADMIN_EMAIL: "Admin@Example.com", ADMIN_PASSWORD: ADMIN_SECRET })
          .bootstrapAdmin,
      ).toEqual({ email: "admin@example.com", password: ADMIN_SECRET });
    });

    it.each([
      [{ ...local, ADMIN_EMAIL: "admin@example.com" }, "ADMIN_PASSWORD: required with ADMIN_EMAIL"],
      [{ ...local, ADMIN_PASSWORD: ADMIN_SECRET }, "ADMIN_EMAIL: required with ADMIN_PASSWORD"],
      // The contract's format: email, which sign-in checks, refuses non-ASCII addresses.
      [
        { ...local, ADMIN_EMAIL: "admin@exämple.com", ADMIN_PASSWORD: ADMIN_SECRET },
        "ADMIN_EMAIL: must be an email address",
      ],
      [
        { ...local, ADMIN_EMAIL: "not an email", ADMIN_PASSWORD: ADMIN_SECRET },
        "ADMIN_EMAIL: must be an email address",
      ],
      [
        { ...local, ADMIN_EMAIL: "admin@example.com", ADMIN_PASSWORD: "short" },
        "ADMIN_PASSWORD: Use at least 12 characters.",
      ],
      [
        {
          STORAGE_PROVIDER: "sqlite",
          ADMIN_EMAIL: "admin@example.com",
          ADMIN_PASSWORD: ADMIN_SECRET,
        },
        "ADMIN_EMAIL: requires USER_DIRECTORY=local",
      ],
    ])("refuses %j, never echoing the password", (env, line) => {
      const message = messageOf(() => load(env));
      expect(message).toContain(`  - ${line}`);
      expect(message).not.toContain(ADMIN_SECRET);
    });
  });

  describe("file storage", () => {
    const S3_SECRET = "S3-Secret-Value-88";
    const sqlite = { STORAGE_PROVIDER: "sqlite" };
    const s3 = { ...sqlite, FILE_STORE: "s3", S3_BUCKET: "studio-files" };

    it("keeps the SQL providers' files on local disk by default, under /data/files", () => {
      expect(loadConfig(sqlite).files).toEqual({ kind: "local", path: resolve("/data/files") });
      expect(loadConfig({ ...sqlite, FILES_PATH: ".data/files" }).files).toEqual({
        kind: "local",
        path: resolve(".data/files"),
      });
    });

    it("leaves files to the other providers' own stores", () => {
      expect(loadConfig({}).files).toBeNull();
      expect(messageOf(() => loadConfig({ FILE_STORE: "local" }))).toContain(
        "  - FILE_STORE: requires STORAGE_PROVIDER=sqlite or postgres",
      );
    });

    it("reads the S3 settings, with the AWS defaults", () => {
      expect(loadConfig(s3).files).toEqual({
        kind: "s3",
        bucket: "studio-files",
        region: "us-east-1",
        endpoint: null,
        forcePathStyle: false,
        credentials: null,
      });
      const config = loadConfig({
        ...s3,
        S3_REGION: "eu-central",
        S3_ENDPOINT: "https://s3.example.net/",
        S3_FORCE_PATH_STYLE: "true",
        S3_ACCESS_KEY_ID: "key-id",
        S3_SECRET_ACCESS_KEY: S3_SECRET,
      });
      expect(config.files).toEqual({
        kind: "s3",
        bucket: "studio-files",
        region: "eu-central",
        endpoint: "https://s3.example.net",
        forcePathStyle: true,
        credentials: { accessKeyId: "key-id", secretAccessKey: S3_SECRET },
      });
      expect(Object.isFrozen(config.files)).toBe(true);
    });

    it.each([
      [{ ...sqlite, FILE_STORE: "s3" }, "S3_BUCKET: required when FILE_STORE=s3"],
      [
        { ...s3, S3_ACCESS_KEY_ID: "key-id" },
        "S3_SECRET_ACCESS_KEY: required with S3_ACCESS_KEY_ID (set both, or neither for the AWS default credentials)",
      ],
      [
        { ...s3, S3_SECRET_ACCESS_KEY: S3_SECRET },
        "S3_ACCESS_KEY_ID: required with S3_SECRET_ACCESS_KEY (set both, or neither for the AWS default credentials)",
      ],
      [
        { ...s3, S3_ENDPOINT: "http://s3.example.net" },
        "S3_ENDPOINT: must be https unless its host is localhost, 127.0.0.1 or [::1]",
      ],
      [{ ...s3, S3_FORCE_PATH_STYLE: "yes" }, "S3_FORCE_PATH_STYLE"],
      [{ ...s3, S3_ALLOW_HTTP: "yes" }, "S3_ALLOW_HTTP"],
      [
        { ...s3, S3_ENDPOINT: "http://s3:9000", S3_ALLOW_HTTP: "false" },
        "S3_ENDPOINT: must be https unless its host is localhost, 127.0.0.1 or [::1]",
      ],
      [{ ...sqlite, FILE_STORE: "azure" }, "FILE_STORE"],
    ])("refuses %j", (env, line) => {
      const message = messageOf(() => loadConfig(env));
      expect(message).toContain(line);
      expect(message).not.toContain(S3_SECRET);
    });

    it("refuses plain http to another host without S3_ALLOW_HTTP, accepts it with true", () => {
      const env = { ...s3, S3_ENDPOINT: "http://s3:9000" };
      expect(messageOf(() => loadConfig(env))).toContain(
        "S3_ENDPOINT: must be https unless its host is localhost, 127.0.0.1 or [::1]",
      );
      expect(loadConfig({ ...env, S3_ALLOW_HTTP: "true" }).files).toMatchObject({
        endpoint: "http://s3:9000",
      });
      expect(
        loadConfig({ ...s3, S3_ENDPOINT: "https://s3.example.net", S3_ALLOW_HTTP: "true" }).files,
      ).toMatchObject({ endpoint: "https://s3.example.net" });
    });

    it("accepts a plain-http endpoint on this machine (the local S3 server)", () => {
      expect(loadConfig({ ...s3, S3_ENDPOINT: "http://127.0.0.1:19000" }).files).toMatchObject({
        endpoint: "http://127.0.0.1:19000",
      });
    });
  });

  describe("empty and blank values", () => {
    it("treat every variable as unset", () => {
      const config = loadConfig({
        NODE_ENV: "",
        HOST: "",
        PORT: "",
        LOG_LEVEL: " ",
        APP_EDITION: "",
        APP_SHELL: "  ",
        AUTH_METHODS: "",
        SURVEYJS_LICENSE_KEY: "",
        STORAGE_PROVIDER: "",
        MEMORY_SEED: "",
        PUBLIC_BASE_URL: "",
        LIMIT_MAX_ASSET_BYTES_PER_SURVEY: "",
        LIMIT_MAX_FILE_BYTES: "",
        LIMIT_MAX_RESPONSE_BYTES: "",
        API_DOCS: "",
        LEGACY_SQL_CONNECTION_STRING: "",
        LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: " ",
        LEGACY_RESULTS_STORAGE_CONNECTION_STRING: "",
        SESSION_SECRET: "",
        SESSION_MAX_AGE_SECONDS: " ",
        OIDC_ISSUER_URL: "",
        OIDC_CLIENT_ID: "",
        OIDC_CLIENT_SECRET: "",
        OIDC_SCOPES: "",
        SIGN_IN_RATE_LIMIT: "",
        ACCOUNT_NOTICES: "",
        USER_DIRECTORY: " ",
        USER_API_URL: "",
        USER_API_TOKEN: "",
        ACCOUNT_WEBHOOK_SECRET: " ",
        SHELL_LINKS: " ",
        READ_ONLY: "",
      });
      expect(config).toEqual(loadConfig({}));
    });

    it('PORT="" is the default 3000, not 0', () => {
      expect(loadConfig({ PORT: "" }).port).toBe(3000);
    });

    it("whitespace-only SURVEYJS_LICENSE_KEY is null", () => {
      expect(loadConfig({ SURVEYJS_LICENSE_KEY: "   " }).surveyjsLicenseKey).toBeNull();
    });

    it("an empty PUBLIC_BASE_URL is still required in production", () => {
      expect(() => loadConfig({ NODE_ENV: "production", PUBLIC_BASE_URL: "" })).toThrow(
        /PUBLIC_BASE_URL: required/,
      );
    });
  });

  describe("integer variables", () => {
    it.each(["1e3", "0x10", "-1", "1.5", "+5", "12px", "٣"])("reject %s", (value) => {
      expect(() => loadConfig({ PORT: value })).toThrow(ConfigError);
      expect(() => loadConfig({ LIMIT_MAX_FILE_BYTES: value })).toThrow(ConfigError);
    });

    it("accept decimal digits", () => {
      expect(loadConfig({ PORT: "8080", LIMIT_MAX_FILE_BYTES: "007" })).toMatchObject({
        port: 8080,
        limits: { maxFileBytes: 7 },
      });
    });
  });

  describe("identity and session", () => {
    const production = { NODE_ENV: "production", PUBLIC_BASE_URL: "https://a.example" };
    const legacyStores = {
      STORAGE_PROVIDER: "azure-legacy",
      LEGACY_SQL_CONNECTION_STRING: "a",
      LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: "b",
      LEGACY_RESULTS_STORAGE_CONNECTION_STRING: "c",
    };

    it("defaults to surveyjs-oidc and requires the OIDC trio", () => {
      const message = messageOf(() => load({}));
      for (const name of ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"]) {
        expect(message).toContain(`${name}: required when IDENTITY_PROVIDER=surveyjs-oidc`);
      }
    });

    it("reads the OIDC settings: RFC 8414 discovery and OAuth 2.0 scopes by default", () => {
      const config = load({ ...oidc });
      expect(config.identityProvider).toBe("surveyjs-oidc");
      expect(config.oidc).toEqual({
        issuerUrl: oidc.OIDC_ISSUER_URL,
        clientId: oidc.OIDC_CLIENT_ID,
        clientSecret: oidc.OIDC_CLIENT_SECRET,
        discovery: "oauth-authorization-server",
        scopes: "profile email",
      });
      expect(load({ ...oidc, OIDC_SCOPES: "openid" }).oidc?.scopes).toBe("openid");
    });

    it("OIDC_DISCOVERY=openid-configuration adds openid to the default scopes", () => {
      const config = load({ ...oidc, OIDC_DISCOVERY: "openid-configuration" });
      expect(config.oidc).toMatchObject({
        discovery: "openid-configuration",
        scopes: "openid profile email",
      });
      expect(
        load({ ...oidc, OIDC_DISCOVERY: "openid-configuration", OIDC_SCOPES: "openid" }).oidc
          ?.scopes,
      ).toBe("openid");
    });

    it("rejects an unknown OIDC_DISCOVERY", () => {
      expect(messageOf(() => load({ ...oidc, OIDC_DISCOVERY: "oidc" }))).toContain(
        "OIDC_DISCOVERY",
      );
    });

    it("does not need the OIDC settings for the dev provider", () => {
      expect(loadConfig({}).oidc).toBeNull();
    });

    it("rejects an OIDC issuer that is not an absolute http(s) URL", () => {
      expect(() => load({ ...oidc, OIDC_ISSUER_URL: "auth.example.com" })).toThrow(
        /OIDC_ISSUER_URL/,
      );
    });

    it("refuses the dev provider in production, hosted and non-memory storage", () => {
      expect(() => loadConfig({ ...production, SESSION_SECRET })).toThrow(
        /IDENTITY_PROVIDER: dev is not allowed when NODE_ENV=production/,
      );
      expect(() => loadConfig({ APP_EDITION: "hosted" })).toThrow(
        /IDENTITY_PROVIDER: dev is not allowed when APP_EDITION=hosted/,
      );
      expect(() => loadConfig(legacyStores)).toThrow(
        /IDENTITY_PROVIDER: dev requires STORAGE_PROVIDER=memory, sqlite or postgres/,
      );
    });

    it("requires SESSION_SECRET in production", () => {
      const env = { ...production, ...oidc };
      expect(() => load(env)).toThrow(/SESSION_SECRET: required when NODE_ENV=production/);
      expect(load({ ...env, SESSION_SECRET }).sessionSecret).toBe(SESSION_SECRET);
    });

    it.each([
      ["an https public origin", "https://localhost:5173"],
      ["a public host", "http://surveys.example.com"],
      ["a LAN address", "http://192.168.1.20:3000"],
    ])("requires SESSION_SECRET outside production for %s", (_label, url) => {
      const env = { PUBLIC_BASE_URL: url };
      expect(() => loadConfig(env)).toThrow(
        /SESSION_SECRET: required when PUBLIC_BASE_URL is https or not on localhost/,
      );
      expect(loadConfig({ ...env, SESSION_SECRET }).sessionSecret).toBe(SESSION_SECRET);
    });

    it.each(["http://localhost:5173", "http://127.0.0.1:3000", "http://[::1]:3000"])(
      "allows the development constant on the loopback origin %s",
      (url) => {
        const config = load({ PUBLIC_BASE_URL: url, APP_EDITION: "hosted", ...oidc });
        expect(config.sessionSecretIsDevDefault).toBe(true);
      },
    );

    it("refuses a plain-http OIDC issuer on a non-loopback host", () => {
      for (const env of [{}, { PUBLIC_BASE_URL: "https://surveys.example.com", SESSION_SECRET }]) {
        const message = messageOf(() =>
          load({ ...oidc, ...env, OIDC_ISSUER_URL: "http://auth.example.com" }),
        );
        expect(message).toContain("OIDC_ISSUER_URL: must be https unless its host is localhost");
      }
    });

    it.each(["http://localhost:18080/surveyjs", "http://127.0.0.1:18080", "http://[::1]:8080"])(
      "allows a plain-http OIDC issuer on the loopback host %s",
      (issuer) => {
        const https = { PUBLIC_BASE_URL: "https://surveys.example.com", SESSION_SECRET };
        expect(load({ ...oidc, OIDC_ISSUER_URL: issuer }).oidc?.issuerUrl).toBe(issuer);
        expect(load({ ...oidc, ...https, OIDC_ISSUER_URL: issuer }).oidc?.issuerUrl).toBe(issuer);
      },
    );

    it("uses the development constant outside production and says so", () => {
      const config = loadConfig({});
      expect(config.sessionSecret).toBe(DEV_SESSION_SECRET);
      expect(config.sessionSecretIsDevDefault).toBe(true);
      const own = loadConfig({ SESSION_SECRET });
      expect(own.sessionSecret).toBe(SESSION_SECRET);
      expect(own.sessionSecretIsDevDefault).toBe(false);
    });

    it("rejects a short SESSION_SECRET without echoing it", () => {
      const thirtyOne = "Short-Secret-Value-1-31-chars-x";
      expect(thirtyOne).toHaveLength(31);
      const message = messageOf(() => loadConfig({ SESSION_SECRET: thirtyOne }));
      expect(message).toContain("SESSION_SECRET: must be at least 32 characters");
      expect(message).not.toContain(thirtyOne);
      expect(loadConfig({ SESSION_SECRET: `${thirtyOne}y` }).sessionSecret).toHaveLength(32);
    });

    it("never echoes the OIDC client secret next to other problems", () => {
      const message = messageOf(() => load({ ...oidc, PORT: "99999" }));
      expect(message).toContain("PORT");
      expect(message).not.toContain(oidc.OIDC_CLIENT_SECRET);
    });

    it("skips the identity rules for tools that do not serve HTTP", () => {
      expect(() => load({})).toThrow(ConfigError);
      expect(load({ ...legacyStores }, { skipIdentityRules: true }).oidc).toBeNull();
      expect(load({ ...production }, { skipIdentityRules: true }).nodeEnv).toBe("production");
    });

    it("validates the numeric settings", () => {
      expect(loadConfig({ SESSION_MAX_AGE_SECONDS: "60", SIGN_IN_RATE_LIMIT: "5" })).toMatchObject({
        sessionMaxAgeSeconds: 60,
        signInRateLimitPerMinute: 5,
      });
      for (const name of ["SESSION_MAX_AGE_SECONDS", "SIGN_IN_RATE_LIMIT"]) {
        for (const value of ["0", "-1", "1.5", "abc"]) {
          expect(() => loadConfig({ [name]: value })).toThrow(name);
        }
      }
    });
  });

  describe("trusted proxy and public rate limits", () => {
    it("lists the trusted peers, trimmed, without blanks", () => {
      expect(loadConfig({ TRUST_PROXY: " 10.0.0.1 , 10.1.0.0/16,::1," }).trustProxy).toEqual([
        "10.0.0.1",
        "10.1.0.0/16",
        "::1",
      ]);
      expect(loadConfig({ TRUST_PROXY: "fd00::/8" }).trustProxy).toEqual(["fd00::/8"]);
    });

    it.each(["10.0.0.0/33", "::1/129", "localhost", "10.0.0.1/"])("refuses %s", (value) => {
      expect(() => loadConfig({ TRUST_PROXY: value })).toThrow(/TRUST_PROXY: must be a comma/);
    });

    it("reads the limits and refuses zero and fractions", () => {
      expect(loadConfig({ PUBLIC_RATE_LIMIT: "5", PUBLIC_FILE_RATE_LIMIT: "7" })).toMatchObject({
        publicRateLimitPerMinute: 5,
        publicFileRateLimitPerMinute: 7,
      });
      for (const name of ["PUBLIC_RATE_LIMIT", "PUBLIC_FILE_RATE_LIMIT"]) {
        for (const value of ["0", "1.5"]) {
          expect(() => loadConfig({ [name]: value })).toThrow(name);
        }
      }
    });
  });

  describe("account notices", () => {
    it.each(["none", "license-expired", "license-expires-soon"])("accepts %s", (value) => {
      expect(loadConfig({ ACCOUNT_NOTICES: value }).accountNotices).toBe(value);
    });

    it("rejects an unknown value", () => {
      expect(() => loadConfig({ ACCOUNT_NOTICES: "banner" })).toThrow(/ACCOUNT_NOTICES/);
    });

    it("accepts surveyjs-licenses only with an SQL or API user directory", () => {
      expect(messageOf(() => loadConfig({ ACCOUNT_NOTICES: "surveyjs-licenses" }))).toContain(
        "ACCOUNT_NOTICES: surveyjs-licenses requires USER_DIRECTORY=surveyjs-sql or surveyjs-api",
      );
      const config = load({
        ...oidc,
        ACCOUNT_NOTICES: "surveyjs-licenses",
        STORAGE_PROVIDER: "azure-legacy",
        LEGACY_SQL_CONNECTION_STRING: "a",
        LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: "b",
        LEGACY_RESULTS_STORAGE_CONNECTION_STRING: "c",
      });
      expect(config.accountNotices).toBe("surveyjs-licenses");
      expect(loadConfig({ ...api, ACCOUNT_NOTICES: "surveyjs-licenses" }).accountNotices).toBe(
        "surveyjs-licenses",
      );
    });
  });

  describe("user directory and account settings", () => {
    const legacy = {
      STORAGE_PROVIDER: "azure-legacy",
      LEGACY_SQL_CONNECTION_STRING: "a",
      LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: "b",
      LEGACY_RESULTS_STORAGE_CONNECTION_STRING: "c",
    };

    it("defaults to the directory that fits the storage provider", () => {
      expect(load({ ...oidc, ...legacy }).userDirectory).toBe("surveyjs-sql");
      expect(loadConfig({}).userDirectory).toBe("memory");
      expect(load({ ...oidc, ...legacy }).userApi).toBeNull();
    });

    it("accepts the surveyjs method on the local directory with the dev sign-in only", () => {
      // The dev sign-in's users are the seed's, which are local accounts; a surveyjs.io identity
      // has no account to link to before self-hosted Step 8.
      expect(loadConfig({ USER_DIRECTORY: "local", IDENTITY_PROVIDER: "dev" }).authMethods).toEqual(
        ["surveyjs"],
      );
    });

    it("accepts the explicit directories that fit", () => {
      expect(loadConfig({ USER_DIRECTORY: "memory" }).userDirectory).toBe("memory");
      expect(load({ ...oidc, ...legacy, USER_DIRECTORY: "surveyjs-sql" }).userDirectory).toBe(
        "surveyjs-sql",
      );
      expect(loadConfig(api).userApi).toEqual({
        url: "https://users.example.com",
        token: "token-Value-31",
      });
    });

    it.each([
      [
        { USER_DIRECTORY: "memory", ...legacy },
        "USER_DIRECTORY: memory requires STORAGE_PROVIDER=memory, sqlite or postgres",
      ],
      [
        { USER_DIRECTORY: "surveyjs-sql" },
        "USER_DIRECTORY: surveyjs-sql requires STORAGE_PROVIDER=azure-legacy",
      ],
      [
        { USER_DIRECTORY: "local", ...legacy },
        "USER_DIRECTORY: local requires STORAGE_PROVIDER=memory, sqlite or postgres",
      ],
      [
        { USER_DIRECTORY: "surveyjs-api", USER_API_TOKEN: "t" },
        "USER_API_URL: required when USER_DIRECTORY=surveyjs-api",
      ],
      [
        { USER_DIRECTORY: "surveyjs-api", USER_API_URL: "https://u.example.com" },
        "USER_API_TOKEN: required when USER_DIRECTORY=surveyjs-api",
      ],
      [
        { ...api, USER_API_URL: "http://users.example.com" },
        "USER_API_URL: must be https unless its host is localhost, 127.0.0.1 or [::1]",
      ],
      [{ AUTH_METHODS: "password" }, "AUTH_METHODS: password requires USER_DIRECTORY=local"],
      [{ AUTH_METHODS: "google" }, "AUTH_METHODS: google requires USER_DIRECTORY=local"],
      [{ AUTH_METHODS: "github" }, "AUTH_METHODS: github requires USER_DIRECTORY=local"],
      [{ AUTH_METHODS: "facebook" }, "AUTH_METHODS: facebook requires USER_DIRECTORY=local"],
      [
        { USER_DIRECTORY: "local", AUTH_METHODS: "google" },
        "GOOGLE_CLIENT_ID: required when AUTH_METHODS includes google",
      ],
      [
        { USER_DIRECTORY: "local", AUTH_METHODS: "google" },
        "GOOGLE_CLIENT_SECRET: required when AUTH_METHODS includes google",
      ],
      [
        { USER_DIRECTORY: "local", AUTH_METHODS: "github" },
        "GITHUB_CLIENT_ID: required when AUTH_METHODS includes github",
      ],
      [
        { USER_DIRECTORY: "local", AUTH_METHODS: "github" },
        "GITHUB_CLIENT_SECRET: required when AUTH_METHODS includes github",
      ],
      [
        { USER_DIRECTORY: "local", AUTH_METHODS: "facebook" },
        "FACEBOOK_CLIENT_ID: required when AUTH_METHODS includes facebook",
      ],
      [
        { USER_DIRECTORY: "local", AUTH_METHODS: "facebook" },
        "FACEBOOK_CLIENT_SECRET: required when AUTH_METHODS includes facebook",
      ],
      [{ SIGN_UP_DOMAINS: "example.com" }, "SIGN_UP_DOMAINS: requires USER_DIRECTORY=local"],
      [
        { USER_DIRECTORY: "local", AUTH_METHODS: "password", SIGN_UP_DOMAINS: "a@example.com" },
        'SIGN_UP_DOMAINS: "a@example.com" is not a domain',
      ],
      [
        { USER_DIRECTORY: "local", AUTH_METHODS: "password", SIGN_UP_DOMAINS: "*.example.com" },
        'SIGN_UP_DOMAINS: "*.example.com" is not a domain',
      ],
      [
        { USER_DIRECTORY: "local", AUTH_METHODS: "password", SIGN_UP_DOMAINS: "localhost" },
        'SIGN_UP_DOMAINS: "localhost" is not a domain',
      ],
      [{ OPEN_SIGN_UP: "on" }, "OPEN_SIGN_UP: requires USER_DIRECTORY=local"],
      [
        { USER_DIRECTORY: "local", AUTH_METHODS: "password", OPEN_SIGN_UP: "on" },
        "OPEN_SIGN_UP: on requires an OAuth2 method in AUTH_METHODS",
      ],
      [
        {
          NODE_ENV: "production",
          PUBLIC_BASE_URL: "https://s.example.com",
          SESSION_SECRET,
          OAUTH_STUB_URL: "https://stub.example.com",
        },
        "OAUTH_STUB_URL: not allowed in production",
      ],
      [
        { OAUTH_STUB_URL: "http://stub.example.com" },
        "OAUTH_STUB_URL: must be https unless its host is localhost, 127.0.0.1 or [::1]",
      ],
      [
        { ACCOUNT_WEBHOOK_SECRET: "whsec_short-Secret-Value-99" },
        "ACCOUNT_WEBHOOK_SECRET: must be whsec_ followed by the base64 of at least 24 bytes",
      ],
    ])("refuses %j with its message", (env, line) => {
      expect(messageOf(() => load({ ...oidc, ...env }))).toContain(`  - ${line}`);
    });

    it.each(["http://127.0.0.1:4010", "http://localhost:4010"])(
      "accepts USER_API_URL=%s",
      (url) => {
        expect(loadConfig({ ...api, USER_API_URL: url }).userApi?.url).toBe(url);
      },
    );

    it("names every method that cannot start on its own line", () => {
      const message = messageOf(() =>
        loadConfig({ AUTH_METHODS: "password,github,facebook,google" }),
      );
      expect(message).toContain("  - AUTH_METHODS: password requires USER_DIRECTORY=local");
      for (const method of ["github", "facebook", "google"]) {
        expect(message).toContain(`  - AUTH_METHODS: ${method} requires USER_DIRECTORY=local`);
      }
    });

    describe("sign-in settings", () => {
      const local = { USER_DIRECTORY: "local" };
      const github = { GITHUB_CLIENT_ID: "gh-id-1", GITHUB_CLIENT_SECRET: "gh-Secret-Value-42" };

      it("accepts surveyjs with a local directory and the OIDC settings", () => {
        const config = load({ ...oidc, IDENTITY_PROVIDER: "surveyjs-oidc", ...local });
        expect(config.userDirectory).toBe("local");
        expect(config.oidc).not.toBeNull();
      });

      it("still requires the OIDC settings for surveyjs with a local directory", () => {
        const message = messageOf(() => load({ IDENTITY_PROVIDER: "surveyjs-oidc", ...local }));
        expect(message).toContain("OIDC_CLIENT_ID: required");
      });

      it("sets only the clients of the listed methods", () => {
        const config = loadConfig({ ...local, AUTH_METHODS: "password,github", ...github });
        expect(config.oauthClients).toEqual({
          google: null,
          github: { clientId: "gh-id-1", clientSecret: "gh-Secret-Value-42" },
          facebook: null,
        });
      });

      it("ignores credentials of a method that is not listed", () => {
        const config = loadConfig({ ...local, AUTH_METHODS: "password", ...github });
        expect(config.oauthClients.github).toBeNull();
      });

      it("lower-cases and deduplicates SIGN_UP_DOMAINS, in order", () => {
        const config = loadConfig({
          ...local,
          AUTH_METHODS: "password",
          SIGN_UP_DOMAINS: " Example.COM ,example.com,acme.org",
        });
        expect(config.joinPolicy).toEqual({
          signUpDomains: ["example.com", "acme.org"],
          openSignUp: false,
        });
      });

      it("turns open sign-up on with an OAuth2 method", () => {
        const config = loadConfig({
          ...local,
          AUTH_METHODS: "password,github",
          ...github,
          OPEN_SIGN_UP: "on",
        });
        expect(config.joinPolicy.openSignUp).toBe(true);
      });

      it("accepts an OAuth stub URL on loopback and drops the trailing slash", () => {
        expect(loadConfig({ OAUTH_STUB_URL: "http://127.0.0.1:4020/" }).oauthStubUrl).toBe(
          "http://127.0.0.1:4020",
        );
        expect(loadConfig({ OAUTH_STUB_URL: "https://stub.example.com" }).oauthStubUrl).toBe(
          "https://stub.example.com",
        );
      });

      it("accepts the hosted example settings with none of the new ones", () => {
        const config = load({
          PUBLIC_BASE_URL: "https://studio.surveyjs.io",
          SESSION_SECRET,
          APP_EDITION: "hosted",
          STORAGE_PROVIDER: "azure-legacy",
          LEGACY_SQL_CONNECTION_STRING: "Server=sql.example.test;Password=dummy-Sql-Value-1",
          LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true",
          LEGACY_RESULTS_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true",
          OIDC_ISSUER_URL: "https://auth.surveyjs.io",
          OIDC_CLIENT_ID: "client-1",
          OIDC_CLIENT_SECRET: "oidc-Secret-Value-77",
          ACCOUNT_NOTICES: "surveyjs-licenses",
          SURVEYJS_LICENSE_KEY: "key-1",
          TRUST_PROXY: "172.30.0.0/24",
          READ_ONLY: "true",
        });
        expect(config.oauthClients).toEqual({ google: null, github: null, facebook: null });
        expect(config.joinPolicy).toEqual({ signUpDomains: [], openSignUp: false });
        expect(config.oauthStubUrl).toBeNull();
      });

      it("never puts a client secret in a configuration error", () => {
        const message = messageOf(() =>
          loadConfig({ AUTH_METHODS: "github", ...github, OPEN_SIGN_UP: "on" }),
        );
        expect(message).not.toContain("gh-Secret-Value-42");
      });
    });

    it("refuses the demo combination on azure-legacy settings with one line", () => {
      const message = messageOf(() =>
        load({
          ...oidc,
          ...legacy,
          IDENTITY_PROVIDER: "surveyjs-oidc",
          USER_DIRECTORY: "surveyjs-sql",
          AUTH_METHODS: "password",
        }),
      );
      const lines = message.split("\n").slice(1);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("  - AUTH_METHODS: password requires USER_DIRECTORY=local");
    });

    it("names USER_DIRECTORY and AUTH_METHODS for the demo combination on memory storage", () => {
      const message = messageOf(() =>
        loadConfig({ USER_DIRECTORY: "surveyjs-sql", AUTH_METHODS: "password" }),
      );
      expect(message).toContain("USER_DIRECTORY: surveyjs-sql requires");
      expect(message).toContain("AUTH_METHODS: password requires");
    });

    it("runs the account rules even when the identity rules are skipped", () => {
      expect(() =>
        load({ USER_DIRECTORY: "local", ...legacy }, { skipIdentityRules: true }),
      ).toThrow("USER_DIRECTORY: local requires STORAGE_PROVIDER=memory, sqlite or postgres");
    });

    it("never echoes the secrets next to other problems", () => {
      const message = messageOf(() =>
        loadConfig({
          ...api,
          USER_API_TOKEN: "token-Secret-Value-77",
          ACCOUNT_WEBHOOK_SECRET: "whsec_short-Secret-Value-99",
          PORT: "99999",
        }),
      );
      expect(message).toContain("PORT");
      expect(message).not.toContain("token-Secret-Value-77");
      expect(message).not.toContain("short-Secret-Value-99");
    });
  });

  describe("SHELL_LINKS", () => {
    it("parses a JSON object of absolute http(s) URLs", () => {
      const links = { help: "https://help.example.com/", billing: "http://localhost:9/b" };
      const config = loadConfig({ SHELL_LINKS: JSON.stringify(links) });
      expect(config.shellLinks).toEqual(links);
      expect(Object.isFrozen(config.shellLinks)).toBe(true);
    });

    it.each([
      "not json",
      "[]",
      "null",
      '"https://a.example"',
      '{"a":1}',
      '{"a":"/relative"}',
      '{"a":"javascript:alert(1)"}',
      '{"a":"ftp://a.example"}',
    ])("rejects %s", (value) => {
      expect(messageOf(() => loadConfig({ SHELL_LINKS: value }))).toContain("SHELL_LINKS");
    });
  });

  describe("REQUEST_TIMEOUT_SECONDS", () => {
    it("defaults to 300 seconds, in milliseconds", () => {
      expect(loadConfig({}).requestTimeoutMs).toBe(300_000);
    });

    it("takes a positive integer of seconds", () => {
      expect(loadConfig({ REQUEST_TIMEOUT_SECONDS: "45" }).requestTimeoutMs).toBe(45_000);
    });

    it.each(["0", "-1", "1.5", "abc"])("refuses %s", (value) => {
      expect(messageOf(() => loadConfig({ REQUEST_TIMEOUT_SECONDS: value }))).toContain(
        "REQUEST_TIMEOUT_SECONDS: ",
      );
    });
  });

  describe("READ_ONLY", () => {
    it("takes true or false", () => {
      expect(loadConfig({ READ_ONLY: "true" }).readOnly).toBe(true);
      expect(loadConfig({ READ_ONLY: "false" }).readOnly).toBe(false);
    });

    it.each(["yes", "1", "TRUE", "on"])("refuses %s", (value) => {
      expect(messageOf(() => loadConfig({ READ_ONLY: value }))).toContain(
        "READ_ONLY: must be true or false",
      );
    });
  });

  describe("WEB_ROOT", () => {
    const absolute = resolve("web-root-for-tests");

    it("takes an absolute path", () => {
      expect(loadConfig({ WEB_ROOT: absolute }).webRoot).toBe(absolute);
    });

    it.each(["web/dist", "./dist", "dist"])("refuses the relative path %s", (value) => {
      expect(messageOf(() => loadConfig({ WEB_ROOT: value }))).toContain(
        "WEB_ROOT: must be an absolute path",
      );
    });
  });
});
