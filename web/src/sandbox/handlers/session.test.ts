import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings";
import { sandboxLicenseKey } from "./session";
import { setupSandbox, USERS } from "./testing";

describe("sandboxLicenseKey", () => {
  it("is null for an unset, empty or blank value and trims the rest", () => {
    expect(sandboxLicenseKey(undefined)).toBeNull();
    expect(sandboxLicenseKey("")).toBeNull();
    expect(sandboxLicenseKey("  ")).toBeNull();
    expect(sandboxLicenseKey(" abc ")).toBe("abc");
  });
});

describe("GET /config", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("answers the key the build baked in", async () => {
    vi.stubEnv("VITE_SANDBOX_LICENSE_KEY", "test-key");
    const config = await (await setupSandbox().call("/config")).json();
    expect(config.surveyjsLicenseKey).toBe("test-key");
  });

  it("answers the demo's configuration with no cookie", async () => {
    vi.stubEnv("VITE_SANDBOX_LICENSE_KEY", "");
    const { call } = setupSandbox();
    const response = await call("/config");
    expect(response.status).toBe(200);
    const config = await response.json();
    expect(config).toMatchObject({
      edition: "self-hosted",
      shell: "self-hosted",
      authMethods: ["password"],
      surveyjsLicenseKey: null,
      readOnly: false,
      features: { embed: false, apiDocs: false, apiTokens: false },
      branding: { name: "SurveyJS Studio demo", logoUrl: null, poweredBy: true },
    });
    expect(config.branding.accentColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("takes the file and quota limits from the settings and the others from the server's defaults", async () => {
    const { call } = setupSandbox({ maxUploadKb: 50 });
    const { limits } = await (await call("/config")).json();
    expect(limits).toEqual({
      maxFileBytes: 50 * 1024,
      maxAssetBytesPerSurvey: 50 * 1024,
      maxResponseBytes: 1048576,
      maxDocumentBytes: 30000000,
    });
    const defaults = await (await setupSandbox().call("/config")).json();
    expect(defaults.limits.maxFileBytes).toBe(DEFAULT_SETTINGS.maxUploadKb * 1024);
  });
});

describe("GET /me", () => {
  it("answers the seed user the msid cookie names, as a local account without a password", async () => {
    const { call } = setupSandbox();
    const response = await call("/me", { user: USERS.member });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: USERS.member,
      displayName: "Mia Member",
      email: "member@example.com",
      avatarUrl: null,
      hasPassword: false,
      notices: [],
    });
  });

  it("answers 401 unauthenticated without the cookie", async () => {
    const { call } = setupSandbox();
    const response = await call("/me");
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(await response.json()).toEqual({
      type: "https://studio.surveyjs.io/problems/unauthenticated",
      title: "Sign-in required",
      status: 401,
      code: "unauthenticated",
    });
  });

  it("answers 401 for an id that is no seed user", async () => {
    const { call } = setupSandbox();
    const response = await call("/me", { user: "11111111-0000-4000-8000-ffffffffffff" });
    expect(response.status).toBe(401);
  });

  it("answers 401 after a reset made the session's user disappear from the data", async () => {
    const { call, ctx } = setupSandbox();
    ctx.store.write((data) => {
      data.users = data.users.filter((user) => user.id !== USERS.member);
    });
    expect((await call("/me", { user: USERS.member })).status).toBe(401);
  });
});

describe("POST /auth/logout", () => {
  it("answers the sign-in page as the redirect, with or without a session", async () => {
    const { call } = setupSandbox();
    for (const user of [USERS.owner, null]) {
      const response = await call("/auth/logout", { method: "POST", user });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ redirectUrl: "/sign-in" });
    }
  });
});

describe("the session cookie", () => {
  it("is read from the Cookie header of the request under Node", async () => {
    const { call } = setupSandbox();
    expect((await call("/me", { user: USERS.owner })).status).toBe(200);
  });

  it("is not seen from document.cookie under jsdom: tests must send the Cookie header", async () => {
    // In a browser, MSW's `cookies` come from document.cookie (D3). Under jsdom, `fetch` is Node's
    // and the request carries no cookie of the document, so a test sets `Cookie` itself.
    const { call } = setupSandbox();
    document.cookie = `msid=${USERS.admin}; path=/`;
    try {
      expect((await call("/me")).status).toBe(401);
    } finally {
      document.cookie = "msid=; path=/; max-age=0";
    }
  });
});
