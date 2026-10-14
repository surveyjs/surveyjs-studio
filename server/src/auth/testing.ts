import type { FastifyInstance, LightMyRequestResponse } from "fastify";

/** Test helper: the cookies and headers of a signed-in browser. */
export interface SignedIn {
  readonly csrf: string;
  /** `Cookie` and `X-CSRF-Token` request headers. */
  readonly headers: { readonly cookie: string; readonly "x-csrf-token": string };
}

export function cookieValue(response: LightMyRequestResponse, name: string): string | undefined {
  return response.cookies.find((cookie) => cookie.name === name)?.value;
}

/** The `login` response's transaction cookie (`msid_auth_<state key>`) as a `Cookie` pair, and its state. */
export function transactionOf(login: LightMyRequestResponse): { cookie: string; state: string } {
  const cookie = login.cookies.find((c) => c.name.startsWith("msid_auth_"));
  const state = new URL(String(login.headers.location)).searchParams.get("state");
  if (login.statusCode !== 302 || !cookie || !state) {
    throw new Error(`login answered ${login.statusCode}`);
  }
  return { cookie: `${cookie.name}=${cookie.value}`, state };
}

/**
 * Signs in over HTTP with the dev identity provider (`login`, then the callback the
 * "Sign in as…" page links to). Test helper; the app must run with `IDENTITY_PROVIDER=dev`.
 */
export async function signIn(app: FastifyInstance, userId: string): Promise<SignedIn> {
  const { cookie, state } = transactionOf(await app.inject("/api/v1/auth/login"));
  const callback = await app.inject({
    url: `/api/v1/auth/callback?${new URLSearchParams({ code: userId, state }).toString()}`,
    headers: { cookie },
  });
  const session = cookieValue(callback, "msid");
  const csrf = cookieValue(callback, "msid_csrf");
  if (callback.statusCode !== 302 || !session || !csrf) {
    throw new Error(`callback answered ${callback.statusCode}`);
  }
  return { csrf, headers: { cookie: `msid=${session}; msid_csrf=${csrf}`, "x-csrf-token": csrf } };
}
