import Fastify from "fastify";
import type { IdentityProvider } from "../identity.js";
import type { SignInTransaction } from "../transaction.js";

/** Test helper: the sign-in parameters of one transaction. */
export const transaction: SignInTransaction = {
  state: "state-1",
  nonce: "nonce-1",
  codeVerifier: "v".repeat(43),
  returnTo: "/",
  exp: 2_000_000_000,
};

/**
 * Test helper: what the server's log would hold for `error`, the line Fastify's logger writes for
 * `{ err: error }` (the error serializer follows `cause`), with the error's message and cause.
 */
export async function loggedError(error: unknown): Promise<string> {
  const lines: string[] = [];
  const app = Fastify({ logger: { stream: { write: (line: string) => lines.push(line) } } });
  app.log.error({ err: error }, "sign-in is unavailable");
  await app.close();
  const { message, cause } = error as Error;
  return [...lines, message, String(cause)].join("\n");
}

export const PUBLIC_BASE_URL = "http://localhost:5173";
export const CALLBACK_URL = `${PUBLIC_BASE_URL}/api/v1/auth/callback`;

export interface Person {
  readonly sub?: string;
  readonly email?: string;
  readonly name?: string;
  readonly verified?: boolean;
}

/**
 * Plays the browser against the OAuth stub: posts the stub's form for the authorization URL and
 * returns the callback URL it redirects to.
 */
export async function authorizeAtStub(
  provider: IdentityProvider,
  person: Person = {},
): Promise<URL> {
  const url = await provider.authorizationUrl(transaction);
  const form = new URLSearchParams(url.searchParams);
  form.set("sub", person.sub ?? "u-42");
  form.set("email", person.email ?? "ada@example.com");
  form.set("name", person.name ?? "Ada Lovelace");
  if (person.verified ?? true) form.set("email_verified", "on");
  const response = await fetch(url.origin + url.pathname, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    redirect: "manual",
  });
  const location = response.headers.get("location");
  if (response.status !== 302 || !location) throw new Error(`the stub answered ${response.status}`);
  return new URL(location);
}
