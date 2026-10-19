import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type BuildOptions } from "../app.js";
import { loadConfig } from "../config.js";
import { createProviders } from "../providers/index.js";
import { blockedUser, ownerUser } from "../providers/suite/expected.js";
import type { IdentityClaims, IdentityProvider } from "./identity.js";
import { createDevIdentityProvider } from "./providers/dev.js";
import { cookieValue, signIn, transactionOf } from "./testing.js";

const devEnv = {
  NODE_ENV: "test",
  IDENTITY_PROVIDER: "dev",
  MEMORY_SEED: "legacy-fixtures",
  PUBLIC_BASE_URL: "http://localhost:5173",
};
const oidcEnv = {
  NODE_ENV: "test",
  OIDC_ISSUER_URL: "https://auth.example.com",
  OIDC_CLIENT_ID: "client",
  OIDC_CLIENT_SECRET: "secret",
};

let app: FastifyInstance | undefined;

async function start(
  env: Record<string, string> = devEnv,
  options?: BuildOptions,
): Promise<FastifyInstance> {
  const config = loadConfig(env);
  app = await buildApp(config, await createProviders(config), options);
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** An identity provider that signs everyone in with fixed claims. */
function fixedClaims(claims: IdentityClaims): IdentityProvider {
  return {
    authorizationUrl: ({ state }) =>
      Promise.resolve(new URL(`https://idp.example/?state=${state}`)),
    finishSignIn: () => Promise.resolve(claims),
    endSessionUrl: () => Promise.resolve("https://idp.example/logout"),
  };
}

describe("sign-in rate limit", () => {
  it("answers 429 rate-limited with Retry-After over the limit", async () => {
    const server = await start({ ...devEnv, SIGN_IN_RATE_LIMIT: "2" });
    for (let i = 0; i < 2; i += 1) {
      expect((await server.inject("/api/v1/auth/login")).statusCode).toBe(302);
    }
    const res = await server.inject("/api/v1/auth/login");
    expect(res.statusCode).toBe(429);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(res.json()).toMatchObject({ code: "rate-limited", status: 429 });
    expect(res.json<{ detail: string }>().detail).toMatch(
      /^Too many sign-in attempts\. Try again in /,
    );
  });

  it("does not limit other operations", async () => {
    const server = await start({ ...devEnv, SIGN_IN_RATE_LIMIT: "1" });
    for (let i = 0; i < 3; i += 1) {
      expect((await server.inject("/api/v1/config")).statusCode).toBe(200);
    }
  });
});

describe("dev sign-in page", () => {
  it("is not served with the surveyjs-oidc provider", async () => {
    const res = await (await start(oidcEnv)).inject("/__dev/sign-in?state=abc");
    expect(res.statusCode).toBe(404);
  });

  it("lists the seed's users, marks blocked ones, and links each to the callback", async () => {
    const res = await (await start()).inject("/__dev/sign-in?state=s-1");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.body).toContain("Olivia Owner");
    expect(res.body).toContain(
      `href="http://localhost:5173/api/v1/auth/callback?code=${ownerUser.id}&amp;state=s-1"`,
    );
    expect(res.body).toMatch(/blocked@example\.com<\/span> <strong class="blocked">blocked/);
  });

  it("escapes HTML in user names, emails and the state", async () => {
    const identity = createDevIdentityProvider({
      publicBaseUrl: "http://localhost:5173",
      users: [
        {
          id: "u-1",
          displayName: "<script>alert(1)</script>",
          email: `"x"@example.com`,
          blocked: false,
        },
      ],
    });
    const state = encodeURIComponent(`"><script>alert(2)</script>`);
    const res = await (await start(devEnv, { identity })).inject(`/__dev/sign-in?state=${state}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("<script>");
    expect(res.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(res.body).toContain("&quot;x&quot;@example.com");
  });

  it("starts a sign-in when opened without one", async () => {
    const res = await (await start()).inject("/__dev/sign-in");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("http://localhost:5173/api/v1/auth/login");
  });
});

describe("login and callback", () => {
  it("redirects back to the normalised returnTo on the public origin", async () => {
    const server = await start();
    const { cookie, state } = transactionOf(
      await server.inject(`/api/v1/auth/login?returnTo=${encodeURIComponent("/€?a=b")}`),
    );
    const callback = await server.inject({
      url: `/api/v1/auth/callback?code=${ownerUser.id}&state=${state}`,
      headers: { cookie },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("http://localhost:5173/%E2%82%AC?a=b");
  });

  it("names the transaction cookie after the state and scopes it to the sign-in endpoints", async () => {
    const login = await (await start()).inject("/api/v1/auth/login");
    const { state } = transactionOf(login);
    expect(login.cookies).toEqual([
      expect.objectContaining({
        name: `msid_auth_${state.slice(0, 16)}`,
        path: "/api/v1/auth",
        maxAge: 600,
        httpOnly: true,
        sameSite: "Lax",
      }),
    ]);
  });

  it("a rejected callback clears its transaction cookie and sets no session", async () => {
    const server = await start();
    const { cookie, state } = transactionOf(await server.inject("/api/v1/auth/login"));
    const name = cookie.slice(0, cookie.indexOf("="));
    // The same cookie name, but not the full state the transaction holds.
    const wrong = `${state.slice(0, 16)}wrong`;
    const res = await server.inject({
      url: `/api/v1/auth/callback?code=${ownerUser.id}&state=${wrong}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "bad-request" });
    expect(res.cookies).toEqual([expect.objectContaining({ name, value: "", maxAge: 0 })]);
  });

  it("a callback with a state that names no cookie is rejected and clears nothing", async () => {
    const server = await start();
    const { cookie } = transactionOf(await server.inject("/api/v1/auth/login"));
    const res = await server.inject({
      url: `/api/v1/auth/callback?code=${ownerUser.id}&state=wrong`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.cookies).toEqual([]);
  });

  it.each([
    ["first tab first", [0, 1]],
    ["second tab first", [1, 0]],
  ])("sign-ins started in two tabs both finish (%s)", async (_label, order) => {
    const server = await start();
    const tabs = [
      transactionOf(await server.inject("/api/v1/auth/login?returnTo=/first")),
      transactionOf(await server.inject("/api/v1/auth/login?returnTo=/second")),
    ];
    // The browser sends every transaction cookie it holds to each callback.
    const cookie = tabs.map((tab) => tab.cookie).join("; ");
    for (const index of order) {
      const tab = tabs[index];
      if (!tab) throw new Error("no such tab");
      const callback = await server.inject({
        url: `/api/v1/auth/callback?code=${ownerUser.id}&state=${tab.state}`,
        headers: { cookie },
      });
      expect(callback.statusCode).toBe(302);
      expect(callback.headers.location).toBe(
        `http://localhost:5173${index === 0 ? "/first" : "/second"}`,
      );
      expect(cookieValue(callback, "msid")).toBeTruthy();
      const cleared = callback.cookies.filter((c) => c.name.startsWith("msid_auth_"));
      expect(cleared.map((c) => [c.name, c.value])).toEqual([
        [tab.cookie.slice(0, tab.cookie.indexOf("=")), ""],
      ]);
    }
  });

  it("a failed callback of a signed-in browser goes to the start page instead of 400", async () => {
    const server = await start();
    const { headers } = await signIn(server, ownerUser.id);
    const { cookie, state } = transactionOf(await server.inject("/api/v1/auth/login"));
    const missing = await server.inject({
      url: `/api/v1/auth/callback?code=${ownerUser.id}&state=${state}`,
      headers: { cookie: headers.cookie },
    });
    expect(missing.statusCode).toBe(302);
    expect(missing.headers.location).toBe("http://localhost:5173/");
    expect(cookieValue(missing, "msid")).toBeUndefined();
    const wrongState = await server.inject({
      url: `/api/v1/auth/callback?code=${ownerUser.id}&state=wrong`,
      headers: { cookie: `${headers.cookie}; ${cookie}` },
    });
    expect(wrongState.statusCode).toBe(302);
    expect(wrongState.headers.location).toBe("http://localhost:5173/");
  });

  it("a blocked user gets 403 forbidden and no session", async () => {
    await expect(signIn(await start(), blockedUser.id)).rejects.toThrow(/403/);
  });

  it("uses the directory's name and email over the claims", async () => {
    const identity = fixedClaims({
      sub: ownerUser.id,
      name: "Claimed",
      email: "claimed@example.com",
    });
    const server = await start(devEnv, { identity });
    const { headers } = await signIn(server, ownerUser.id);
    const me = await server.inject({ url: "/api/v1/me", headers });
    expect(me.json()).toEqual({
      id: ownerUser.id,
      displayName: "Olivia Owner",
      email: "owner@example.com",
      avatarUrl: null,
      notices: [],
    });
  });

  it.each(["not a url", "javascript:alert(1)", "/relative.png"])(
    "drops a picture claim that is not an absolute http(s) URL (%s)",
    async (picture) => {
      const identity = fixedClaims({ sub: "new-user", email: "new@example.com", picture });
      const server = await start(devEnv, { identity });
      const { headers } = await signIn(server, "ignored");
      const me = await server.inject({ url: "/api/v1/me", headers });
      expect(me.json()).toMatchObject({ avatarUrl: null });
    },
  );

  it.each([
    ["no email claim", {}],
    ["an empty email claim", { email: "" }],
  ])("refuses an identity with %s with 400 and no session", async (_label, extra) => {
    const identity = fixedClaims({ sub: "new-user", name: "No Mail", ...extra });
    const server = await start(devEnv, { identity });
    const { cookie, state } = transactionOf(await server.inject("/api/v1/auth/login"));
    const callback = await server.inject({
      url: `/api/v1/auth/callback?code=x&state=${state}`,
      headers: { cookie },
    });
    expect(callback.statusCode).toBe(400);
    expect(callback.json()).toMatchObject({ code: "bad-request" });
    expect(cookieValue(callback, "msid")).toBeUndefined();
  });

  it("uses the claims for a user the directory does not know", async () => {
    const identity = fixedClaims({
      sub: "new-user",
      email: "new@example.com",
      picture: "https://idp.example/new.png",
    });
    const server = await start(devEnv, { identity });
    const { headers } = await signIn(server, "ignored");
    const me = await server.inject({ url: "/api/v1/me", headers });
    expect(me.json()).toEqual({
      id: "new-user",
      displayName: "new@example.com",
      email: "new@example.com",
      avatarUrl: "https://idp.example/new.png",
      notices: [],
    });
  });
});

describe("account notices", () => {
  it("getCurrentUser includes the demo notice that ACCOUNT_NOTICES selects", async () => {
    const server = await start({ ...devEnv, ACCOUNT_NOTICES: "license-expired" });
    const { headers } = await signIn(server, ownerUser.id);
    const me = await server.inject({ url: "/api/v1/me", headers });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      id: ownerUser.id,
      notices: [
        {
          code: "license-expired",
          message: "Your renewal subscription has expired.",
          actionUrl: "https://surveyjs.io/manage",
          actionLabel: "Renew",
        },
      ],
    });
  });
  it("points the licence notice's Renew link at the settings shell link", async () => {
    const server = await start({
      ...devEnv,
      ACCOUNT_NOTICES: "license-expires-soon",
      SHELL_LINKS: JSON.stringify({ settings: "https://account.example.com/licences" }),
    });
    const { headers } = await signIn(server, ownerUser.id);
    const me = await server.inject({ url: "/api/v1/me", headers });
    expect(me.json()).toMatchObject({
      notices: [
        { code: "license-expires-soon", actionUrl: "https://account.example.com/licences" },
      ],
    });
  });

  it("getCurrentUser answers without notices when the notice store fails", async () => {
    const config = loadConfig(devEnv);
    const providers = await createProviders(config);
    const failing = {
      ...providers,
      notices: { noticesFor: () => Promise.reject(new Error("Legacy SQL licence list failed")) },
    };
    app = await buildApp(config, failing);
    const { headers } = await signIn(app, ownerUser.id);
    const me = await app.inject({ url: "/api/v1/me", headers });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ id: ownerUser.id, notices: [] });
  });
});

describe("request rules", () => {
  it("checks authentication before validation", async () => {
    const res = await (
      await start()
    ).inject({
      method: "POST",
      url: "/api/v1/surveys",
      payload: { name: 5 },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "unauthenticated" });
  });

  it("checks the CSRF token before validation", async () => {
    const server = await start();
    const { headers } = await signIn(server, ownerUser.id);
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/surveys",
      headers: { cookie: headers.cookie },
      payload: { name: 5 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "csrf-token-invalid" });
  });

  it("rejects a CSRF header that matches the cookie but not the session", async () => {
    const server = await start();
    const { headers } = await signIn(server, ownerUser.id);
    const session = headers.cookie.split(";")[0] ?? "";
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: `${session}; msid_csrf=forged`, "x-csrf-token": "forged" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("treats an expired or tampered session as signed out", async () => {
    let now = Date.parse("2026-10-01T00:00:00Z");
    const server = await start({ ...devEnv, SESSION_MAX_AGE_SECONDS: "60" }, { now: () => now });
    const { headers } = await signIn(server, ownerUser.id);
    expect((await server.inject({ url: "/api/v1/me", headers })).statusCode).toBe(200);
    const tampered = headers.cookie.replace(
      /msid=([^;]*?)(.);/,
      (_m, rest: string, last: string) => `msid=${rest}${last === "A" ? "B" : "A"};`,
    );
    expect(
      (await server.inject({ url: "/api/v1/me", headers: { cookie: tampered } })).statusCode,
    ).toBe(401);
    now += 60_000;
    expect((await server.inject({ url: "/api/v1/me", headers })).statusCode).toBe(401);
  });

  it("logout clears the cookies and returns the public start page for the dev provider", async () => {
    const server = await start();
    const { headers } = await signIn(server, ownerUser.id);
    const { cookie: transaction } = transactionOf(await server.inject("/api/v1/auth/login"));
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { ...headers, cookie: `${headers.cookie}; ${transaction}; msid_auth_bad=1` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ redirectUrl: "http://localhost:5173/" });
    const cleared = res.cookies.map((cookie) => [cookie.name, cookie.value, cookie.maxAge]);
    expect(cleared).toEqual([
      ["msid", "", 0],
      ["msid_csrf", "", 0],
      [transaction.slice(0, transaction.indexOf("=")), "", 0],
    ]);
  });

  it("logout without a session answers where to go next and clears the cookies", async () => {
    const res = await (await start()).inject({ method: "POST", url: "/api/v1/auth/logout" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ redirectUrl: "http://localhost:5173/" });
    expect(res.cookies.map((cookie) => [cookie.name, cookie.maxAge])).toEqual([
      ["msid", 0],
      ["msid_csrf", 0],
    ]);
  });

  it("logout with an expired or tampered session counts as no session, even without CSRF", async () => {
    let now = Date.parse("2026-10-01T00:00:00Z");
    const server = await start({ ...devEnv, SESSION_MAX_AGE_SECONDS: "60" }, { now: () => now });
    const { headers } = await signIn(server, ownerUser.id);
    const tampered = await server.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: "msid=v1.AAAA.BBBB" },
    });
    expect(tampered.statusCode).toBe(200);
    now += 60_000;
    const expired = await server.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: headers.cookie },
    });
    expect(expired.statusCode).toBe(200);
    expect(expired.json()).toEqual({ redirectUrl: "http://localhost:5173/" });
  });

  it("logout with a valid session still needs the CSRF token", async () => {
    const server = await start();
    const { headers } = await signIn(server, ownerUser.id);
    const res = await server.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: headers.cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "csrf-token-invalid" });
    expect(res.cookies).toEqual([]);
  });
});
