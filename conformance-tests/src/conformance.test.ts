import { describe, expect, it, onTestFinished } from "vitest";
import { baseUrl, call, cleanUp, codeOf, sessionHeaders, signedIn, validator } from "./harness.js";
import { CookieJar, finishSignIn, fixtureUsers, startSignIn } from "./sign-in.js";

const { owner, blocked } = fixtureUsers;
/** The owner's "Customer feedback" survey of the fixtures. */
const SURVEY_ID = "22222222-0000-4000-8000-a00000000001";

describe(`server at ${baseUrl}`, () => {
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
      const history = await call("GET", "/surveys/{surveyId}/history", {
        path: `/surveys/${SURVEY_ID}/history`,
      });
      expect(history.status).toBe(401);
      const clone = await call("POST", "/surveys/{surveyId}/clones", {
        path: `/surveys/${SURVEY_ID}/clones`,
        body: {},
      });
      expect(clone.status).toBe(401);
      expect(await codeOf(clone)).toBe("unauthenticated");
    });

    it("a change without the CSRF token answers 403 csrf-token-invalid", async (ctx) => {
      const session = await signedIn(ctx);
      const response = await call("POST", "/surveys", {
        headers: { cookie: session.jar.header() },
        body: {},
      });
      if (response.status === 201) {
        // The server should have refused; do not leave the survey behind.
        const { id } = (await response.clone().json()) as { id: string };
        onTestFinished(() => cleanUp(sessionHeaders(session), id));
      }
      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe("csrf-token-invalid");
    });
  });

  it("an unknown route answers 404 not-found", async () => {
    const response = await fetch(`${baseUrl}/api/v1/does-not-exist`);
    expect(response.status).toBe(404);
    expect(await (await validator()).checkProblem(response)).toEqual([]);
    expect(await response.json()).toMatchObject({ code: "not-found" });
  });
});
