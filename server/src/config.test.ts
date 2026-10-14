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
    ["APP_SHELL", ""],
    ["AUTH_METHODS", "magic"],
    ["AUTH_METHODS", ""],
    ["STORAGE_PROVIDER", "postgres"],
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
});
