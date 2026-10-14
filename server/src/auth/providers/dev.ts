import type { FastifyPluginAsync } from "fastify";
import type { User } from "../../domain/types.js";
import { AppError } from "../../errors.js";
import { publicUrl, type IdentityProvider } from "../identity.js";

/** Served outside `/api/v1` and not in the contract; registered only with `IDENTITY_PROVIDER=dev`. */
export const DEV_SIGN_IN_PATH = "/__dev/sign-in";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** No scripts, no forms, no framing: the page is a list of links. */
const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function page(users: readonly User[], callbackUrl: (user: User) => string): string {
  const items = users.map((user) => {
    const blocked = user.blocked ? ' <strong class="blocked">blocked</strong>' : "";
    return `<li><a href="${escapeHtml(callbackUrl(user))}">${escapeHtml(user.displayName)}</a> <span>${escapeHtml(user.email)}</span>${blocked}</li>`;
  });
  const list =
    items.length > 0
      ? `<ul>\n${items.join("\n")}\n</ul>`
      : "<p>The memory seed has no users. Start the server with <code>MEMORY_SEED=legacy-fixtures</code>.</p>";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in as… (development)</title>
<style>
body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 40rem; padding: 0 1rem; }
li { margin: 0.5rem 0; }
span { color: #555; }
.blocked { color: #b00020; }
</style>
</head>
<body>
<h1>Sign in as…</h1>
<p>Development sign-in: no password is asked. Never available in production.</p>
${list}
</body>
</html>
`;
}

export interface DevIdentityOptions {
  readonly publicBaseUrl: string;
  /** The users of the memory seed, listed on the sign-in page. */
  readonly users: readonly User[];
}

/**
 * Development identity provider: a "Sign in as…" page lists the seed's users, and each choice
 * goes to the regular callback with the user id as the code, so the dev flow uses the same
 * callback, cookies and checks as OIDC.
 */
export function createDevIdentityProvider(options: DevIdentityOptions): IdentityProvider {
  const { publicBaseUrl, users } = options;
  const callbackUrl = (state: string) => (user: User) =>
    `${publicUrl(publicBaseUrl, "/api/v1/auth/callback")}?${new URLSearchParams({ code: user.id, state }).toString()}`;

  const routes: FastifyPluginAsync = (app) => {
    app.get(DEV_SIGN_IN_PATH, (request, reply) => {
      const { state } = request.query as { state?: unknown };
      // Opened directly, without a sign-in in progress: start one.
      if (typeof state !== "string" || state === "") {
        return reply.redirect(publicUrl(publicBaseUrl, "/api/v1/auth/login"), 302);
      }
      return reply.headers(PAGE_HEADERS).send(page(users, callbackUrl(state)));
    });
    return Promise.resolve();
  };

  return {
    authorizationUrl: ({ state }) => {
      const url = new URL(publicUrl(publicBaseUrl, DEV_SIGN_IN_PATH));
      url.searchParams.set("state", state);
      return Promise.resolve(url);
    },
    finishSignIn: (callback) => {
      const code = (callback.searchParams.get("code") ?? "").toLowerCase();
      const user = users.find((candidate) => candidate.id.toLowerCase() === code);
      if (!user) {
        return Promise.reject(
          new AppError({ code: "bad-request", status: 400, title: "Unknown sign-in code" }),
        );
      }
      return Promise.resolve({ sub: user.id, email: user.email, name: user.displayName });
    },
    endSessionUrl: () => Promise.resolve(publicUrl(publicBaseUrl, "/")),
    routes,
  };
}
