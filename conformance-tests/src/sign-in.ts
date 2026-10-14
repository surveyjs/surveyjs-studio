/**
 * Sign-in driver: signs in over HTTP only, the way a browser would, by following the redirects
 * of `/auth/login`. It completes the dev identity provider's "Sign in as…" page
 * (`IDENTITY_PROVIDER=dev`) and the login form of the mock OIDC server (mock-oauth2-server, used
 * in Azurite mode); other identity providers are reported as unsupported.
 */

/** Users of the legacy fixtures (server/fixtures/legacy) the reference server is seeded with. */
export const fixtureUsers = {
  owner: {
    id: "11111111-0000-4000-8000-a00000000001",
    displayName: "Olivia Owner",
    email: "owner@example.com",
  },
  blocked: { id: "11111111-0000-4000-8000-a00000000005" },
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

  /** The `Cookie` request header. */
  header(): string {
    return [...this.values].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

export class SignInUnsupportedError extends Error {}

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
