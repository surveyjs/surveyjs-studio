import { openapiPath } from "@my-surveys/contract";
import { beforeAll, describe, expect, inject, it, type TestContext } from "vitest";
import {
  CookieJar,
  finishSignIn,
  fixtureUsers,
  signIn,
  SignInUnsupportedError,
  startSignIn,
  type SignInResult,
} from "./sign-in.js";
import { createValidator, type Validator } from "./validator.js";

const baseUrl = inject("baseUrl");
const { owner, blocked } = fixtureUsers;

interface CallOptions {
  /** The concrete path, when it differs from the contract's path template. */
  readonly path?: string;
  readonly headers?: Record<string, string>;
  /** Sent as JSON. */
  readonly body?: unknown;
}

describe(`server at ${baseUrl}`, () => {
  let validator: Validator;
  beforeAll(async () => {
    validator = await createValidator(openapiPath);
  });

  async function expectConforms(method: string, pathTemplate: string, response: Response) {
    expect(await validator.check(method, pathTemplate, response)).toEqual([]);
  }

  /** Calls `/api/v1{path}` (redirects not followed) and fails unless the response conforms. */
  async function call(method: string, pathTemplate: string, options: CallOptions = {}) {
    const json = options.body !== undefined;
    const response = await fetch(`${baseUrl}/api/v1${options.path ?? pathTemplate}`, {
      method,
      redirect: "manual",
      headers: { ...(json && { "content-type": "application/json" }), ...options.headers },
      ...(json && { body: JSON.stringify(options.body) }),
    });
    await expectConforms(method, pathTemplate, response);
    return response;
  }

  async function codeOf(response: Response): Promise<unknown> {
    return ((await response.clone().json()) as { code?: unknown }).code;
  }

  /**
   * Signs in through the login redirects and checks both API responses. Skips the test when the
   * sign-in driver cannot complete the server's identity provider.
   */
  async function signedIn(
    ctx: TestContext,
    userId: string = owner.id,
    returnTo = "/",
    complete: () => Promise<SignInResult> = () => signIn(baseUrl, userId, returnTo),
  ) {
    let result: SignInResult;
    try {
      result = await complete();
    } catch (error) {
      if (error instanceof SignInUnsupportedError) ctx.skip(error.message);
      throw error;
    }
    await expectConforms("GET", "/auth/login", result.login);
    await expectConforms("GET", "/auth/callback", result.callback);
    return result;
  }

  /** Request headers of a signed-in browser that sends its CSRF token. */
  function sessionHeaders({ jar }: SignInResult): Record<string, string> {
    return { cookie: jar.header(), "x-csrf-token": jar.get("msid_csrf") ?? "" };
  }

  it("getConfig answers 200 with the configuration", async () => {
    const response = await call("GET", "/config");
    expect(response.status).toBe(200);
  });

  describe("sign-in", () => {
    it("login redirects to the identity provider with a sign-in cookie", async () => {
      const response = await call("GET", "/auth/login");
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBeTruthy();
      const cookies = response.headers.getSetCookie();
      // One cookie per sign-in, named after the first 16 characters of its state.
      const state = new URL(response.headers.get("location") ?? "").searchParams.get("state");
      expect(cookies).toEqual([
        expect.stringMatching(
          new RegExp(`^msid_auth_${state?.slice(0, 16) ?? ""}=[^;]+;.*HttpOnly`),
        ),
      ]);
    });

    it("login rejects a returnTo outside the site with 400", async () => {
      const response = await call("GET", "/auth/login", {
        path: "/auth/login?returnTo=//evil.com",
      });
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe("bad-request");
    });

    it("the callback sets the session cookies and redirects to returnTo", async (ctx) => {
      const { callback } = await signedIn(ctx, owner.id, "/surveys?view=1");
      expect(callback.status).toBe(302);
      const location = new URL(callback.headers.get("location") ?? "", baseUrl);
      expect(location.pathname + location.search).toBe("/surveys?view=1");
      const cookies = callback.headers.getSetCookie();
      const named = (name: string) => cookies.find((cookie) => cookie.startsWith(`${name}=`)) ?? "";
      expect(named("msid")).toMatch(/^msid=[^;]+;/);
      expect(named("msid")).toMatch(/;\s*HttpOnly/i);
      expect(named("msid")).toMatch(/;\s*SameSite=Lax/i);
      expect(named("msid_csrf")).toMatch(/^msid_csrf=[^;]+;/);
      expect(named("msid_csrf")).not.toMatch(/HttpOnly/i);
      expect(cookies.find((cookie) => cookie.startsWith("msid_auth_"))).toMatch(/Max-Age=0/i);
    });

    it("sign-ins started in two tabs of one browser both finish", async (ctx) => {
      const jar = new CookieJar();
      const first = await startSignIn(baseUrl, "/first", jar);
      const second = await startSignIn(baseUrl, "/second", jar);
      for (const [start, path] of [
        [second, "/second"],
        [first, "/first"],
      ] as const) {
        const { callback } = await signedIn(ctx, owner.id, path, () =>
          finishSignIn(start, owner.id),
        );
        expect(callback.status).toBe(302);
        expect(new URL(callback.headers.get("location") ?? "", baseUrl).pathname).toBe(path);
      }
    });

    it("the callback rejects a wrong state with 400", async () => {
      const { jar } = await startSignIn(baseUrl);
      const response = await call("GET", "/auth/callback", {
        path: `/auth/callback?code=${owner.id}&state=wrong`,
        headers: { cookie: jar.header() },
      });
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe("bad-request");
    });

    it("the callback rejects a sign-in without its transaction cookie with 400", async () => {
      const { location } = await startSignIn(baseUrl);
      const state = location.searchParams.get("state") ?? "any";
      const response = await call("GET", "/auth/callback", {
        path: `/auth/callback?code=${owner.id}&state=${encodeURIComponent(state)}`,
      });
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe("bad-request");
    });

    it("a blocked user gets 403 forbidden and no session", async (ctx) => {
      const { callback, jar } = await signedIn(ctx, blocked.id);
      expect(callback.status).toBe(403);
      expect(await codeOf(callback)).toBe("forbidden");
      expect(jar.get("msid")).toBeUndefined();
      expect(jar.get("msid_csrf")).toBeUndefined();
    });

    it("passwordLogin answers 501 not-implemented", async () => {
      const response = await call("POST", "/auth/password/login", {
        body: { email: "owner@example.com", password: "secret" },
      });
      expect(response.status).toBe(501);
      expect(await codeOf(response)).toBe("not-implemented");
    });
  });

  describe("session", () => {
    it("getCurrentUser answers 401 unauthenticated when signed out", async () => {
      const response = await call("GET", "/me");
      expect(response.status).toBe(401);
      expect(await codeOf(response)).toBe("unauthenticated");
    });

    it("getCurrentUser answers the signed-in user", async (ctx) => {
      const session = await signedIn(ctx);
      const response = await call("GET", "/me", { headers: { cookie: session.jar.header() } });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { notices?: unknown };
      expect(body).toMatchObject({
        id: owner.id,
        displayName: owner.displayName,
        email: owner.email,
      });
      // Each notice matches the contract's Notice schema (checked by `call`); which notices a user
      // gets depends on the server's ACCOUNT_NOTICES (server tests cover the settings).
      expect(Array.isArray(body.notices)).toBe(true);
    });

    it("logout clears the cookies and returns where to go next", async (ctx) => {
      const session = await signedIn(ctx);
      const response = await call("POST", "/auth/logout", { headers: sessionHeaders(session) });
      expect(response.status).toBe(200);
      const { redirectUrl } = (await response.clone().json()) as { redirectUrl: string };
      const next = new URL(redirectUrl);
      if (session.location.pathname === "/__dev/sign-in") {
        // The dev provider has no session of its own: back to the site's start page.
        expect(next.pathname).toBe("/");
      } else {
        // OIDC: the identity provider's end_session_endpoint, which returns to the start page.
        expect(next.origin).toBe(session.location.origin);
        expect(next.searchParams.get("client_id")).toBeTruthy();
        const back = new URL(next.searchParams.get("post_logout_redirect_uri") ?? "");
        expect(back.pathname).toBe("/");
      }
      session.jar.store(response);
      expect(session.jar.get("msid")).toBeUndefined();
      expect(session.jar.get("msid_csrf")).toBeUndefined();
      const me = await call("GET", "/me", { headers: { cookie: session.jar.header() } });
      expect(me.status).toBe(401);
    });

    it("logout without a session answers where to go next and clears the cookies", async () => {
      const response = await call("POST", "/auth/logout");
      expect(response.status).toBe(200);
      const { redirectUrl } = (await response.clone().json()) as { redirectUrl: string };
      expect(URL.canParse(redirectUrl)).toBe(true);
      const cookies = response.headers.getSetCookie();
      for (const name of ["msid", "msid_csrf"]) {
        expect(cookies.find((cookie) => cookie.startsWith(`${name}=`))).toMatch(/Max-Age=0/i);
      }
    });

    it("logout without the CSRF token, or with a wrong one, answers 403", async (ctx) => {
      const session = await signedIn(ctx);
      const cookie = session.jar.header();
      const attempts: Record<string, string>[] = [{ cookie }, { cookie, "x-csrf-token": "wrong" }];
      for (const headers of attempts) {
        const response = await call("POST", "/auth/logout", { headers });
        expect(response.status).toBe(403);
        expect(await codeOf(response)).toBe("csrf-token-invalid");
      }
    });
  });

  describe("authentication of private operations", () => {
    it("an anonymous call answers 401, even to an unimplemented operation", async () => {
      const list = await call("GET", "/surveys");
      expect(list.status).toBe(401);
      const create = await call("POST", "/surveys", { body: {} });
      expect(create.status).toBe(401);
      expect(await codeOf(create)).toBe("unauthenticated");
    });

    it("a change without the CSRF token answers 403 csrf-token-invalid", async (ctx) => {
      const session = await signedIn(ctx);
      const response = await call("POST", "/surveys", {
        headers: { cookie: session.jar.header() },
        body: {},
      });
      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe("csrf-token-invalid");
    });

    it("an unimplemented operation answers 501 not-implemented", async (ctx) => {
      const session = await signedIn(ctx);
      const list = await call("GET", "/surveys", { headers: sessionHeaders(session) });
      expect(list.status).toBe(501);
      expect(await codeOf(list)).toBe("not-implemented");
      const create = await call("POST", "/surveys", { headers: sessionHeaders(session), body: {} });
      expect(create.status).toBe(501);
    });
  });

  it("an unknown route answers 404 not-found", async () => {
    const response = await fetch(`${baseUrl}/api/v1/does-not-exist`);
    expect(response.status).toBe(404);
    expect(await validator.checkProblem(response)).toEqual([]);
    expect(await response.json()).toMatchObject({ code: "not-found" });
  });
});
