import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

/** The dev sign-in, so no OIDC settings are needed. */
const load = (env: Record<string, string>) => loadConfig({ IDENTITY_PROVIDER: "dev", ...env });

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).message;
  }
  throw new Error("expected a ConfigError");
}

describe("branding settings", () => {
  it("defaults to the app's name, the SurveyJS colour and the Powered by mark", () => {
    expect(load({}).branding).toEqual({
      name: "My Surveys",
      logoUrl: null,
      accentColor: "#19b394",
      termsUrl: null,
      privacyUrl: null,
      poweredBy: true,
    });
  });

  it("reads the instance's name, logo, colour and links", () => {
    const config = load({
      BRAND_NAME: "  Acme Surveys  ",
      BRAND_LOGO_URL: "https://cdn.acme.example/logo.svg",
      BRAND_ACCENT_COLOR: "#0A7",
      TERMS_URL: "https://acme.example/terms",
      PRIVACY_URL: "https://acme.example/privacy",
    });
    expect(config.branding).toEqual({
      name: "Acme Surveys",
      logoUrl: "https://cdn.acme.example/logo.svg",
      accentColor: "#0a7",
      termsUrl: "https://acme.example/terms",
      privacyUrl: "https://acme.example/privacy",
      poweredBy: true,
    });
  });

  it("reads a blank BRAND_NAME as unset, like every variable", () => {
    expect(load({ BRAND_NAME: "   " }).branding.name).toBe("My Surveys");
  });

  it("takes a logo from this site's own paths", () => {
    expect(load({ BRAND_LOGO_URL: "/brand/logo.png" }).branding.logoUrl).toBe("/brand/logo.png");
  });

  it.each(["/\\evil.example/logo.png", "/\\\\evil.example"])(
    "refuses a backslash in a site path (%s): browsers read it as a slash",
    (logo) => {
      expect(messageOf(() => load({ BRAND_LOGO_URL: logo }))).toContain(
        "  - BRAND_LOGO_URL: must be an https URL or a path on this site (/...)",
      );
    },
  );

  it("switches the Powered by mark off only with a licence key", () => {
    expect(load({ BRANDING: "off", SURVEYJS_LICENSE_KEY: "own-key" }).branding.poweredBy).toBe(
      false,
    );
    expect(messageOf(() => load({ BRANDING: "off" }))).toContain(
      "  - BRANDING: off requires SURVEYJS_LICENSE_KEY (your own SurveyJS licence key)",
    );
  });

  it.each([
    [{ BRAND_NAME: "n".repeat(81) }, "BRAND_NAME: must be at most 80 characters"],
    [
      { BRAND_LOGO_URL: "http://acme.example/logo.png" },
      "BRAND_LOGO_URL: must be an https URL or a path on this site (/...)",
    ],
    [
      { BRAND_LOGO_URL: "//acme.example/logo.png" },
      "BRAND_LOGO_URL: must be an https URL or a path on this site (/...)",
    ],
    [{ BRAND_ACCENT_COLOR: "green" }, "BRAND_ACCENT_COLOR: must be a colour like #19b394"],
    [{ BRAND_ACCENT_COLOR: "#12345" }, "BRAND_ACCENT_COLOR: must be a colour like #19b394"],
    [{ TERMS_URL: "javascript:alert(1)" }, "TERMS_URL: must be an http(s) URL"],
    [{ PRIVACY_URL: "not a url" }, "PRIVACY_URL: must be an http(s) URL"],
    [{ BRANDING: "maybe" }, "BRANDING"],
  ])("refuses %j", (env, line) => {
    expect(messageOf(() => load(env))).toContain(`  - ${line}`);
  });
});

describe("features by shell", () => {
  it("shows the Embed tab, the API docs and API tokens in the surveyjs-site shell", () => {
    expect(load({ NODE_ENV: "test", API_DOCS: "true" }).features).toEqual({
      embed: true,
      apiDocs: true,
      apiTokens: true,
    });
  });

  it.each(["self-hosted", "plain", "acme"])("hides them in the %s shell", (shell) => {
    const config = load({ NODE_ENV: "test", APP_SHELL: shell });
    expect(config.features).toEqual({ embed: false, apiDocs: false, apiTokens: false });
    expect(config.apiDocs).toBe(false);
  });

  it("refuses API_DOCS=true outside the surveyjs-site shell", () => {
    expect(messageOf(() => load({ APP_SHELL: "self-hosted", API_DOCS: "true" }))).toContain(
      "  - API_DOCS: true requires APP_SHELL=surveyjs-site (the API docs are shown only there)",
    );
  });

  it("honours API_DOCS=true in production in the surveyjs-site shell", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      APP_SHELL: "surveyjs-site",
      API_DOCS: "true",
      PUBLIC_BASE_URL: "https://a.example",
      SESSION_SECRET: "0123456789abcdef0123456789abcdef",
      OIDC_ISSUER_URL: "https://auth.example.com",
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: "oidc-Secret-Value-77",
    });
    expect(config.apiDocs).toBe(true);
    expect(config.features.apiDocs).toBe(true);
  });

  it("keeps the API docs off where API_DOCS keeps them off", () => {
    expect(load({ NODE_ENV: "test", API_DOCS: "false" }).features.apiDocs).toBe(false);
  });
});
