import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

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
    });
  });

  it("returns a frozen config", () => {
    expect(Object.isFrozen(loadConfig({}))).toBe(true);
  });

  it("reads every variable", () => {
    const config = loadConfig({
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
      loadConfig({ NODE_ENV: "production", PUBLIC_BASE_URL: "https://a.example" }).apiDocs,
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
      STORAGE_PROVIDER: "azure-legacy",
      LEGACY_SQL_CONNECTION_STRING: `Server=sql.example.net;${SECRET}`,
      LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: `AccountName=surveys;AccountKey=${SECRET}`,
      LEGACY_RESULTS_STORAGE_CONNECTION_STRING: `AccountName=results;AccountKey=${SECRET}`,
    };

    function messageOf(run: () => unknown): string {
      try {
        run();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        return (error as ConfigError).message;
      }
      throw new Error("expected a ConfigError");
    }

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
});
