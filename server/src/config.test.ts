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
      storageProvider: "memory",
      memorySeed: "empty",
      legacy: null,
      publicBaseUrl: "http://localhost:3000",
      limits: {
        maxAssetBytesPerSurvey: 52428800,
        maxFileBytes: 10485760,
        maxResponseBytes: 1048576,
      },
      apiDocs: true,
      identityProvider: "dev",
      sessionSecret: DEV_SESSION_SECRET,
      sessionSecretIsDevDefault: true,
      sessionMaxAgeSeconds: 43200,
      oidc: null,
      signInRateLimitPerMinute: 30,
      accountNotices: "none",
      shellLinks: {},
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
      AUTH_METHODS: "password, oidc",
      SURVEYJS_LICENSE_KEY: "key-1",
      STORAGE_PROVIDER: "memory",
      MEMORY_SEED: "legacy-fixtures",
      PUBLIC_BASE_URL: "https://surveys.example.com",
      LIMIT_MAX_ASSET_BYTES_PER_SURVEY: "10",
      LIMIT_MAX_FILE_BYTES: "20",
      LIMIT_MAX_RESPONSE_BYTES: "30",
      API_DOCS: "true",
    });
    expect(config).toMatchObject({
      nodeEnv: "production",
      host: "0.0.0.0",
      port: 0,
      logLevel: "debug",
      edition: "hosted",
      shell: "acme",
      authMethods: ["password", "oidc"],
      surveyjsLicenseKey: "key-1",
      memorySeed: "legacy-fixtures",
      publicBaseUrl: "https://surveys.example.com",
      limits: { maxAssetBytesPerSurvey: 10, maxFileBytes: 20, maxResponseBytes: 30 },
      apiDocs: true,
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
    ["STORAGE_PROVIDER", "postgres"],
    ["MEMORY_SEED", "demo"],
    ["PUBLIC_BASE_URL", "not a url"],
    ["PUBLIC_BASE_URL", "ftp://example.com"],
    ["LIMIT_MAX_ASSET_BYTES_PER_SURVEY", "0"],
    ["LIMIT_MAX_FILE_BYTES", "-5"],
    ["LIMIT_MAX_RESPONSE_BYTES", "1.5"],
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
    expect(loadConfig({ PUBLIC_BASE_URL: "https://a.example/" }).publicBaseUrl).toBe(
      "https://a.example",
    );
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
        SHELL_LINKS: " ",
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
        /IDENTITY_PROVIDER: dev requires STORAGE_PROVIDER=memory/,
      );
    });

    it("requires SESSION_SECRET in production", () => {
      const env = { ...production, ...oidc };
      expect(() => load(env)).toThrow(/SESSION_SECRET: required when NODE_ENV=production/);
      expect(load({ ...env, SESSION_SECRET }).sessionSecret).toBe(SESSION_SECRET);
    });

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

  describe("account notices", () => {
    it.each(["none", "license-expired", "license-expires-soon"])("accepts %s", (value) => {
      expect(loadConfig({ ACCOUNT_NOTICES: value }).accountNotices).toBe(value);
    });

    it("rejects an unknown value", () => {
      expect(() => loadConfig({ ACCOUNT_NOTICES: "banner" })).toThrow(/ACCOUNT_NOTICES/);
    });

    it("accepts surveyjs-licenses only with the azure-legacy provider", () => {
      expect(() => loadConfig({ ACCOUNT_NOTICES: "surveyjs-licenses" })).toThrow(
        /ACCOUNT_NOTICES: surveyjs-licenses requires STORAGE_PROVIDER=azure-legacy/,
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
});
