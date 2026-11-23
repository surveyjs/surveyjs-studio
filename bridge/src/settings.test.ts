import { describe, expect, it } from "vitest";
import { loadSettings, SettingsError } from "./settings.js";

const REQUIRED = {
  BRIDGE_STUDIO_URL: "http://127.0.0.1:3000/api/v1",
  BRIDGE_LEGACY_URL: "https://old.example.com",
};

describe("loadSettings", () => {
  it("applies the defaults", () => {
    expect(loadSettings(REQUIRED)).toEqual({
      studioUrl: "http://127.0.0.1:3000/api/v1",
      legacyUrl: "https://old.example.com",
      cacheEntries: 10_000,
      port: 3002,
      host: "127.0.0.1",
      studioTimeoutMs: 10_000,
      fileTimeoutMs: 120_000,
      maxUploadBytes: 11_534_336,
      trustProxy: [],
      metricsPort: null,
      metricsHost: "127.0.0.1",
    });
  });

  it("reads every setting", () => {
    expect(
      loadSettings({
        ...REQUIRED,
        BRIDGE_CACHE_ENTRIES: "50",
        BRIDGE_PORT: "8081",
        BRIDGE_HOST: "0.0.0.0",
        BRIDGE_STUDIO_TIMEOUT_MS: "2500",
        BRIDGE_FILE_TIMEOUT_MS: "30000",
        BRIDGE_MAX_UPLOAD_BYTES: "1048576",
        BRIDGE_TRUST_PROXY: " 10.0.0.1, 172.16.0.0/12 ,::1",
        BRIDGE_METRICS_PORT: "9102",
        BRIDGE_METRICS_HOST: "0.0.0.0",
      }),
    ).toEqual({
      studioUrl: "http://127.0.0.1:3000/api/v1",
      legacyUrl: "https://old.example.com",
      cacheEntries: 50,
      port: 8081,
      host: "0.0.0.0",
      studioTimeoutMs: 2500,
      fileTimeoutMs: 30_000,
      maxUploadBytes: 1_048_576,
      trustProxy: ["10.0.0.1", "172.16.0.0/12", "::1"],
      metricsPort: 9102,
      metricsHost: "0.0.0.0",
    });
  });

  it.each([
    [{ BRIDGE_LEGACY_URL: REQUIRED.BRIDGE_LEGACY_URL }, "BRIDGE_STUDIO_URL"],
    [{ BRIDGE_STUDIO_URL: REQUIRED.BRIDGE_STUDIO_URL }, "BRIDGE_LEGACY_URL"],
    [{ ...REQUIRED, BRIDGE_STUDIO_URL: "studio:3000" }, "BRIDGE_STUDIO_URL"],
    [{ ...REQUIRED, BRIDGE_LEGACY_URL: "ftp://old.example.com" }, "BRIDGE_LEGACY_URL"],
    [{ ...REQUIRED, BRIDGE_LEGACY_URL: "https://old.example.com/?a=1" }, "BRIDGE_LEGACY_URL"],
    [{ ...REQUIRED, BRIDGE_CACHE_ENTRIES: "1e3" }, "BRIDGE_CACHE_ENTRIES"],
    [{ ...REQUIRED, BRIDGE_CACHE_ENTRIES: "-1" }, "BRIDGE_CACHE_ENTRIES"],
    [{ ...REQUIRED, BRIDGE_PORT: "0" }, "BRIDGE_PORT"],
    [{ ...REQUIRED, BRIDGE_PORT: "65536" }, "BRIDGE_PORT"],
    [{ ...REQUIRED, BRIDGE_HOST: "" }, "BRIDGE_HOST"],
    [{ ...REQUIRED, BRIDGE_STUDIO_TIMEOUT_MS: "0" }, "BRIDGE_STUDIO_TIMEOUT_MS"],
    [{ ...REQUIRED, BRIDGE_FILE_TIMEOUT_MS: "0" }, "BRIDGE_FILE_TIMEOUT_MS"],
    [{ ...REQUIRED, BRIDGE_FILE_TIMEOUT_MS: "3600001" }, "BRIDGE_FILE_TIMEOUT_MS"],
    [{ ...REQUIRED, BRIDGE_MAX_UPLOAD_BYTES: "0" }, "BRIDGE_MAX_UPLOAD_BYTES"],
    [{ ...REQUIRED, BRIDGE_MAX_UPLOAD_BYTES: "30000001" }, "BRIDGE_MAX_UPLOAD_BYTES"],
    [{ ...REQUIRED, BRIDGE_TRUST_PROXY: "10.0.0.1,proxy.local" }, "BRIDGE_TRUST_PROXY"],
    [{ ...REQUIRED, BRIDGE_TRUST_PROXY: "10.0.0.0/33" }, "BRIDGE_TRUST_PROXY"],
    [{ ...REQUIRED, BRIDGE_METRICS_PORT: "0" }, "BRIDGE_METRICS_PORT"],
    [{ ...REQUIRED, BRIDGE_METRICS_PORT: "65536" }, "BRIDGE_METRICS_PORT"],
    [{ ...REQUIRED, BRIDGE_METRICS_HOST: "" }, "BRIDGE_METRICS_HOST"],
  ])("refuses %j (%s)", (env, name) => {
    expect(() => loadSettings(env)).toThrow(SettingsError);
    expect(() => loadSettings(env)).toThrow(name);
  });

  it("refuses BRIDGE_METRICS_PORT equal to BRIDGE_PORT, the default one included", () => {
    expect(() =>
      loadSettings({ ...REQUIRED, BRIDGE_PORT: "9000", BRIDGE_METRICS_PORT: "9000" }),
    ).toThrow("BRIDGE_METRICS_PORT must differ from BRIDGE_PORT");
    expect(() => loadSettings({ ...REQUIRED, BRIDGE_METRICS_PORT: "3002" })).toThrow(
      "BRIDGE_METRICS_PORT must differ from BRIDGE_PORT",
    );
  });

  it("lists every problem at once", () => {
    expect(() => loadSettings({ BRIDGE_PORT: "x" })).toThrow(
      /BRIDGE_STUDIO_URL[\s\S]*BRIDGE_LEGACY_URL[\s\S]*BRIDGE_PORT/,
    );
  });
});
