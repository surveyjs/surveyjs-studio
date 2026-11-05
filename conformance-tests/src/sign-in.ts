/**
 * Sign-in driver: signs in over HTTP only, the way a browser would, by following the redirects
 * of `/auth/login`. It completes the dev identity provider's "Sign in as…" page
 * (`IDENTITY_PROVIDER=dev`) and the login form of the mock OIDC server (mock-oauth2-server, used
 * in Azurite mode); other identity providers are reported as unsupported. The sandbox
 * (`CONFORMANCE_PROVIDER=sandbox`) has no sign-in over HTTP: `sandboxSession` sets its cookie.
 */
import { readFileSync } from "node:fs";

/** Users of the legacy fixtures (server/fixtures/legacy) the reference server is seeded with. */
export const fixtureUsers = {
  owner: {
    id: "11111111-0000-4000-8000-a00000000001",
    displayName: "Olivia Owner",
    email: "owner@example.com",
  },
  admin: {
    id: "11111111-0000-4000-8000-a00000000002",
    displayName: "Adam Admin",
    email: "admin@example.com",
  },
  member: {
    id: "11111111-0000-4000-8000-a00000000003",
    displayName: "Mia Member",
    email: "member@example.com",
  },
  outsider: {
    id: "11111111-0000-4000-8000-a00000000004",
    displayName: "Oscar Outsider",
    email: "outsider@example.com",
  },
  blocked: { id: "11111111-0000-4000-8000-a00000000005" },
  erasable: {
    id: "11111111-0000-4000-8000-a00000000006",
    displayName: "Erin Erasable",
    email: "erasable@example.com",
  },
  /** The seed's instance admin: a local account only (USER_DIRECTORY=local, self-hosted Step 5). */
  instanceAdmin: {
    id: "11111111-0000-4000-8000-a00000000007",
    displayName: "Ivy Instance",
    email: "instance-admin@example.com",
  },
} as const;

/** A minimal cookie jar: names and values only (paths and domains are not tracked). */
export class CookieJar {
  private readonly values = new Map<string, string>();

  /** Applies every `Set-Cookie` of a response; `Max-Age=0` removes the cookie. */
  store(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";");
      const at = pair.indexOf("=");
      if (at < 1) continue;
      const name = pair.slice(0, at).trim();
      const removed = attributes.some((attribute) => /^\s*max-age\s*=\s*0\s*$/i.test(attribute));
      if (removed) this.values.delete(name);
      else this.values.set(name, pair.slice(at + 1).trim());
    }
  }

  get(name: string): string | undefined {
    return this.values.get(name);
  }

  set(name: string, value: string): void {
    this.values.set(name, value);
  }

  /** The `Cookie` request header. */
  header(): string {
    return [...this.values].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

export class SignInUnsupportedError extends Error {}

let sandboxUserIds: Set<string> | undefined;

/** The ids of the users of the sandbox seed (web/src/sandbox/seed.json), lower case. */
function sandboxUsers(): Set<string> {
  if (!sandboxUserIds) {
    const seed = JSON.parse(
      readFileSync(new URL("../../web/src/sandbox/seed.json", import.meta.url), "utf8"),
    ) as { users: { id: string; blocked?: boolean }[] };
    sandboxUserIds = new Set(
      seed.users.filter((user) => !user.blocked).map((user) => user.id.toLowerCase()),
    );
  }
  return sandboxUserIds;
}

/**
 * A session of the sandbox (D3 of self-hosted Step 9): the `msid` cookie naming a user of its seed,
 * and no CSRF cookie; no HTTP. A fixture user the seed leaves out (blocked, erasable, the instance
 * admin) cannot sign in there: SignInUnsupportedError.
 */
export function sandboxSession(userId: string): CookieJar {
  if (!sandboxUsers().has(userId.toLowerCase())) {
    throw new SignInUnsupportedError(
      `user ${userId} is not in the sandbox seed (server/fixtures/sandbox.json)`,
    );
  }
  const jar = new CookieJar();
  jar.set("msid", userId);
  return jar;
}

const DEV_SIGN_IN_PATH = "/__dev/sign-in";

function decodeEntities(text: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
  };
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => entities[entity] ?? entity);
}

export interface SignInStart {
  readonly jar: CookieJar;
  /** The `login` response (`302` to the identity provider). */
  readonly login: Response;
  readonly location: URL;
}

/**
 * Calls `login` and keeps its cookies (the sign-in's `msid_auth_<state key>`) in `jar` (a new one
 * by default; pass one to start several sign-ins in the same browser).
 */
export async function startSignIn(
  baseUrl: string,
  returnTo = "/",
  jar = new CookieJar(),
): Promise<SignInStart> {
  const query = new URLSearchParams({ returnTo }).toString();
  const login = await fetch(`${baseUrl}/api/v1/auth/login?${query}`, { redirect: "manual" });
  jar.store(login);
  const target = login.headers.get("location");
  if (login.status !== 302 || target === null) {
    throw new Error(`login answered ${login.status}, not a redirect`);
  }
  return { jar, login, location: new URL(target, baseUrl) };
}

export interface SignInResult extends SignInStart {
  /** The `loginCallback` response; the jar holds its cookies. */
  readonly callback: Response;
}

/** The dev provider's "Sign in as…" page: the link of the chosen user is the callback URL. */
async function completeDevPage(location: URL, userId: string): Promise<URL> {
  const page = await fetch(location, { redirect: "manual" });
  if (page.status !== 200) throw new Error(`${DEV_SIGN_IN_PATH} answered ${page.status}`);
  const links = [...(await page.text()).matchAll(/href="([^"]*)"/g)].map(
    (match) => new URL(decodeEntities(match[1] ?? ""), location),
  );
  const choice = links.find(
    (link) => link.searchParams.get("code")?.toLowerCase() === userId.toLowerCase(),
  );
  if (!choice) throw new Error(`${DEV_SIGN_IN_PATH} does not list user ${userId}`);
  return choice;
}

/**
 * The mock OIDC server's login page: a form that posts `username` (the subject) to the
 * authorization URL, which then redirects to the callback. Its configuration
 * (docker/mock-oidc.json) gives each fixture user's id its email and name claims.
 */
async function completeMockOidcLogin(location: URL, userId: string): Promise<URL | null> {
  const page = await fetch(location, { redirect: "manual" });
  const html = page.status === 200 ? await page.text() : "";
  const form = /<form\b[^>]*\bmethod="post"[^>]*>/i.exec(html)?.[0];
  if (!form || !/<input\b[^>]*\bname="username"/i.test(html)) return null;
  const action = /\baction="([^"]*)"/i.exec(form)?.[1];
  const target = action ? new URL(decodeEntities(action), location) : location;
  const login = await fetch(target, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: userId }).toString(),
  });
  const callback = login.headers.get("location");
  if (login.status !== 302 || callback === null) {
    throw new Error(`the mock OIDC login form answered ${login.status}, not a redirect`);
  }
  return new URL(callback, target);
}

/** The person an OAuth stub sign-in enters on the stub's form. */
export interface StubPerson {
  readonly sub: string;
  readonly email: string;
  readonly name?: string;
  /** The form's `email_verified` box; checked unless false. */
  readonly verified?: boolean;
}

export interface OAuthSignIn {
  /** The browser's cookies after the callback. */
  readonly jar: CookieJar;
  /** The `loginCallback` response. */
  readonly callback: Response;
  /** Where the callback redirects: `returnTo` when signed in, else the refused page. */
  readonly location: URL;
}

export type StubMethod = "google" | "github" | "facebook" | "surveyjs";

/** A sign-in authorized at the stub: the callback URL the browser is about to open. */
export interface AuthorizedAtStub {
  readonly baseUrl: string;
  readonly jar: CookieJar;
  readonly callbackUrl: URL;
}

/**
 * Signs in with an OAuth2 method against the OAuth stub (`CONFORMANCE_AUTH=oauth`), over HTTP as
 * a browser would: `login?provider=`, the stub's form posted with `person` (its hidden fields as
 * the stub filled them), then the callback the stub redirects to.
 */
export async function oauthSignIn(
  baseUrl: string,
  provider: StubMethod,
  person: StubPerson,
): Promise<OAuthSignIn> {
  return openCallback(await authorizeAtStub(baseUrl, provider, person));
}

/** `login?provider=` and the stub's form, up to the callback URL (not opened yet). */
export async function authorizeAtStub(
  baseUrl: string,
  provider: StubMethod,
  person: StubPerson,
): Promise<AuthorizedAtStub> {
  const jar = new CookieJar();
  const query = new URLSearchParams({ provider, returnTo: "/" }).toString();
  const login = await fetch(`${baseUrl}/api/v1/auth/login?${query}`, { redirect: "manual" });
  jar.store(login);
  const authorize = login.headers.get("location");
  if (login.status !== 302 || authorize === null) {
    throw new Error(`login answered ${login.status}, not a redirect`);
  }
  const page = await fetch(authorize, { redirect: "manual" });
  const html = page.status === 200 ? await page.text() : "";
  const action = /<form\b[^>]*\bmethod="post"[^>]*\baction="([^"]*)"/i.exec(html)?.[1];
  if (action === undefined) throw new Error(`the stub's authorize page answered ${page.status}`);
  const form = new URLSearchParams();
  for (const [, name = "", value = ""] of html.matchAll(
    /<input type="hidden" name="([^"]*)" value="([^"]*)">/g,
  )) {
    form.set(decodeEntities(name), decodeEntities(value));
  }
  form.set("sub", person.sub);
  form.set("email", person.email);
  form.set("name", person.name ?? person.email);
  if (person.verified ?? true) form.set("email_verified", "on");
  form.set("allow", "1");
  const target = new URL(decodeEntities(action), authorize);
  const posted = await fetch(target, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const back = posted.headers.get("location");
  if (posted.status !== 302 || back === null) {
    throw new Error(`the stub's form answered ${posted.status}, not a redirect`);
  }
  return { baseUrl, jar, callbackUrl: new URL(back, target) };
}

/** Opens the callback of a sign-in authorized at the stub. */
export async function openCallback(authorized: AuthorizedAtStub): Promise<OAuthSignIn> {
  const { baseUrl, jar, callbackUrl } = authorized;
  const callback = await fetch(callbackUrl, {
    redirect: "manual",
    headers: { cookie: jar.header() },
  });
  jar.store(callback);
  return { jar, callback, location: new URL(callback.headers.get("location") ?? "", baseUrl) };
}

/**
 * Signs in as `userId` and returns the browser state. Throws SignInUnsupportedError when the
 * server's identity provider is not one the driver can complete.
 */
export async function signIn(
  baseUrl: string,
  userId: string,
  returnTo = "/",
): Promise<SignInResult> {
  return finishSignIn(await startSignIn(baseUrl, returnTo), userId);
}

/** Completes a started sign-in as `userId`: the provider's page, then the callback. */
export async function finishSignIn(start: SignInStart, userId: string): Promise<SignInResult> {
  const { jar, location } = start;
  const callbackUrl =
    location.pathname === DEV_SIGN_IN_PATH
      ? await completeDevPage(location, userId)
      : await completeMockOidcLogin(location, userId);
  if (!callbackUrl) {
    throw new SignInUnsupportedError(
      `login redirects to ${location.origin}${location.pathname}; the sign-in driver completes only the dev provider's ${DEV_SIGN_IN_PATH} page and the mock OIDC server's login form`,
    );
  }
  const callback = await fetch(callbackUrl, {
    redirect: "manual",
    headers: { cookie: jar.header() },
  });
  jar.store(callback);
  return { ...start, callback };
}
