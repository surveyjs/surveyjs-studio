/**
 * A test-only HTTP server that plays Google (OpenID), surveyjs.io (RFC 8414 OAuth 2.0 + UserInfo),
 * GitHub and Facebook. Used by unit tests, the conformance global setup, Playwright and the demo
 * (`pnpm oauth-stub`). Production code never imports it. Never contacts a real provider.
 *
 * Client ids are free; the client secret of each provider is `stub-secret-<provider>`.
 */
import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  sign,
  timingSafeEqual,
} from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface OAuthStub {
  readonly url: string;
  close(): Promise<void>;
}

type ProviderId = "google" | "surveyjs" | "github" | "facebook";

interface Identity {
  readonly sub: string;
  readonly email: string;
  readonly name: string;
  /** null: the answers leave `email_verified` (GitHub's `verified`) out. */
  readonly emailVerified: boolean | null;
}

/** The form fields the stub reads itself; any other query parameter is echoed as hidden. */
const OWN_FIELDS = new Set([
  "sub",
  "email",
  "name",
  "email_verified",
  "omit_email_verified",
  "deny",
]);

interface Code {
  readonly provider: ProviderId;
  readonly identity: Identity;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string | null;
  readonly nonce: string | null;
  readonly expiresAt: number;
}

interface AccessToken {
  readonly provider: ProviderId;
  readonly identity: Identity;
}

interface ProviderConfig {
  readonly title: string;
  readonly authorizePath: string;
}

const CODE_TTL_MS = 60_000;
const TOKEN_TTL_S = 3600;

const providers: Record<ProviderId, ProviderConfig> = {
  google: { title: "Google", authorizePath: "/google/authorize" },
  surveyjs: { title: "surveyjs.io", authorizePath: "/surveyjs/authorize" },
  github: { title: "GitHub", authorizePath: "/github/login/oauth/authorize" },
  facebook: { title: "Facebook", authorizePath: "/facebook/dialog/oauth" },
};

const tokenPaths: Record<string, ProviderId> = {
  "/google/token": "google",
  "/surveyjs/token": "surveyjs",
  "/github/login/oauth/access_token": "github",
  "/facebook-graph/oauth/access_token": "facebook",
};

const secretOf = (provider: ProviderId) => `stub-secret-${provider}`;
const randomToken = () => randomBytes(24).toString("base64url");
const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const b64 = (value: Buffer | string) => Buffer.from(value).toString("base64url");

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

interface Reply {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

const json = (status: number, value: unknown): Reply => ({
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(value),
});
const redirect = (location: string): Reply => ({
  status: 302,
  headers: { location, "cache-control": "no-store" },
  body: "",
});
const html = (status: number, body: string): Reply => ({
  status,
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  body,
});
const oauthError = (status: number, error: string): Reply => json(status, { error });

/** The `email_verified` claim, or nothing when the form left it out. */
const verifiedClaim = (verified: boolean | null) =>
  verified === null ? {} : { email_verified: verified };

/**
 * A token request the provider refuses, in the provider's own shape: GitHub answers `200` with an
 * `error` field, Facebook a Graph error object (code 100 for a bad code), the others OAuth 2.0.
 */
function tokenRefused(provider: ProviderId, reason: "code" | "client"): Reply {
  if (provider === "github") {
    const error = reason === "code" ? "bad_verification_code" : "incorrect_client_credentials";
    return json(200, {
      error,
      error_description:
        reason === "code"
          ? "The code passed is incorrect or expired."
          : "The client_id and/or client_secret passed are incorrect.",
      error_uri: `https://docs.github.com/apps/managing-oauth-apps/troubleshooting-oauth-app-access-token-request-errors/#${error.replaceAll("_", "-")}`,
    });
  }
  if (provider === "facebook") {
    return json(400, {
      error: {
        message:
          reason === "code"
            ? "Invalid verification code format."
            : "Error validating client secret.",
        type: "OAuthException",
        code: reason === "code" ? 100 : 1,
        fbtrace_id: "stub",
      },
    });
  }
  return reason === "code" ? oauthError(400, "invalid_grant") : oauthError(401, "invalid_client");
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body;
}

function bearerOf(request: IncomingMessage, url: URL): string {
  const header = /^(?:Bearer|token) (.+)$/i.exec(request.headers.authorization ?? "")?.[1];
  return header ?? url.searchParams.get("access_token") ?? "";
}

/** GitHub ids are numbers: the form's sub when numeric, else a stable hash of it. */
function numericId(sub: string): number {
  if (/^\d{1,15}$/.test(sub)) return Number(sub);
  return createHash("sha256").update(sub).digest().readUIntBE(0, 6);
}

export async function startOAuthStub(
  options: { readonly port?: number; readonly host?: string } = {},
): Promise<OAuthStub> {
  const host = options.host ?? "127.0.0.1";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "stub-key", alg: "RS256", use: "sig" };
  const codes = new Map<string, Code>();
  const accessTokens = new Map<string, AccessToken>();
  let origin = "";

  const signJwt = (claims: Record<string, unknown>): string => {
    const input = `${b64(JSON.stringify({ alg: "RS256", kid: "stub-key", typ: "JWT" }))}.${b64(JSON.stringify(claims))}`;
    return `${input}.${b64(sign("sha256", Buffer.from(input), privateKey))}`;
  };

  const metadata = (provider: "google" | "surveyjs") => {
    const issuer = `${origin}/${provider}`;
    const common = {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    };
    if (provider === "surveyjs") return { ...common, scopes_supported: ["profile", "email"] };
    return {
      ...common,
      jwks_uri: `${issuer}/jwks`,
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      scopes_supported: ["openid", "email", "profile"],
    };
  };

  function authorizeForm(provider: ProviderId, params: URLSearchParams): Reply {
    const { title, authorizePath } = providers[provider];
    const hidden = [...params]
      .filter(([key]) => !OWN_FIELDS.has(key))
      .map(
        ([key, value]) =>
          `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`,
      )
      .join("\n");
    const text = (name: string) =>
      `<p><label>${name} <input type="text" name="${name}" value="${escapeHtml(params.get(name) ?? "")}"></label></p>`;
    return html(
      200,
      `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign in to the ${escapeHtml(title)} stub</title></head>
<body>
<h1>Sign in to the ${escapeHtml(title)} stub</h1>
<form method="post" action="${escapeHtml(authorizePath)}">
${hidden}
${text("sub")}
${text("email")}
${text("name")}
<p><label><input type="checkbox" name="email_verified" checked> email_verified</label></p>
<p><label><input type="checkbox" name="omit_email_verified"> leave email_verified out</label></p>
<p><button type="submit" name="allow" value="1">Sign in</button> <button type="submit" name="deny" value="1">Deny</button></p>
</form>
</body>
</html>
`,
    );
  }

  function authorize(provider: ProviderId, method: string, params: URLSearchParams): Reply {
    const redirectUri = params.get("redirect_uri") ?? "";
    let target: URL;
    try {
      target = new URL(redirectUri);
      if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error();
    } catch {
      return html(400, "<!doctype html><title>Bad request</title><p>redirect_uri is required.</p>");
    }
    const method256 = params.get("code_challenge_method");
    if (method256 !== null && method256 !== "S256") {
      return html(400, "<!doctype html><title>Bad request</title><p>Only S256 is supported.</p>");
    }
    if (method === "GET") return authorizeForm(provider, params);

    const state = params.get("state");
    if (state !== null) target.searchParams.set("state", state);
    if (params.has("deny")) {
      target.searchParams.set("error", "access_denied");
      return redirect(target.href);
    }
    const email = (params.get("email") ?? "").trim();
    const sub = (params.get("sub") ?? "").trim() || email;
    if (sub === "") {
      return html(400, "<!doctype html><title>Bad request</title><p>Enter a sub or an email.</p>");
    }
    const code = randomToken();
    codes.set(code, {
      provider,
      identity: {
        sub,
        email,
        name: (params.get("name") ?? "").trim(),
        emailVerified: params.has("omit_email_verified") ? null : params.has("email_verified"),
      },
      clientId: params.get("client_id") ?? "",
      redirectUri,
      challenge: params.get("code_challenge"),
      nonce: params.get("nonce"),
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    target.searchParams.set("code", code);
    return redirect(target.href);
  }

  function clientSecret(request: IncomingMessage, form: URLSearchParams): [string, string] {
    const basic = /^Basic (.+)$/i.exec(request.headers.authorization ?? "")?.[1];
    if (basic !== undefined) {
      const [id = "", ...rest] = Buffer.from(basic, "base64").toString().split(":");
      return [decodeURIComponent(id), decodeURIComponent(rest.join(":"))];
    }
    return [form.get("client_id") ?? "", form.get("client_secret") ?? ""];
  }

  function token(provider: ProviderId, request: IncomingMessage, form: URLSearchParams): Reply {
    const [clientId, secret] = clientSecret(request, form);
    if (!safeEqual(secret, secretOf(provider))) return tokenRefused(provider, "client");
    const codeValue = form.get("code") ?? "";
    const code = codes.get(codeValue);
    codes.delete(codeValue); // single use, whatever the outcome
    const challenge = code?.challenge ?? null;
    const valid =
      code !== undefined &&
      code.provider === provider &&
      code.expiresAt > Date.now() &&
      (form.get("grant_type") ?? "authorization_code") === "authorization_code" &&
      code.clientId === clientId &&
      form.get("redirect_uri") === code.redirectUri &&
      (challenge === null || s256(form.get("code_verifier") ?? "") === challenge);
    if (!valid) return tokenRefused(provider, "code");

    const accessToken = randomToken();
    accessTokens.set(accessToken, { provider, identity: code.identity });
    const response: Record<string, unknown> = {
      access_token: accessToken,
      token_type: provider === "github" ? "bearer" : "Bearer",
      expires_in: TOKEN_TTL_S,
    };
    if (provider === "google") {
      const now = Math.floor(Date.now() / 1000);
      const { sub, email, name, emailVerified } = code.identity;
      response.id_token = signJwt({
        iss: `${origin}/google`,
        aud: clientId,
        sub,
        iat: now,
        exp: now + TOKEN_TTL_S,
        ...(code.nonce !== null && { nonce: code.nonce }),
        email,
        ...verifiedClaim(emailVerified),
        name,
      });
    }
    if (provider === "github") {
      const accepted = request.headers.accept ?? "";
      if (!accepted.includes("application/json")) {
        return {
          status: 200,
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "cache-control": "no-store",
          },
          body: new URLSearchParams({
            access_token: accessToken,
            token_type: "bearer",
            scope: "",
          }).toString(),
        };
      }
      response.scope = "";
    }
    return json(200, response);
  }

  function userEndpoint(
    provider: ProviderId,
    request: IncomingMessage,
    url: URL,
    path: string,
  ): Reply | null {
    const bearer = bearerOf(request, url);
    const entry = accessTokens.get(bearer);
    if (entry === undefined || entry.provider !== provider) return oauthError(401, "invalid_token");
    const { sub, email, name, emailVerified } = entry.identity;
    switch (path) {
      case "/google/userinfo":
        return json(200, { sub, email, ...verifiedClaim(emailVerified), name });
      case "/surveyjs/userinfo":
        return json(200, { sub, email, ...verifiedClaim(emailVerified), name });
      case "/github-api/user": {
        const login = (email.split("@")[0] || sub).replace(/[^A-Za-z0-9-]/g, "-");
        return json(200, {
          id: numericId(sub),
          login,
          name,
          avatar_url: `${origin}/github-api/avatars/${encodeURIComponent(login)}.png`,
        });
      }
      case "/github-api/user/emails":
        return json(
          200,
          email === ""
            ? []
            : [
                {
                  email,
                  primary: true,
                  ...(emailVerified !== null && { verified: emailVerified }),
                },
              ],
        );
      case "/facebook-graph/me": {
        const proof = url.searchParams.get("appsecret_proof") ?? "";
        const expected = createHmac("sha256", secretOf("facebook")).update(bearer).digest("hex");
        if (!safeEqual(proof, expected)) {
          return json(400, {
            error: { message: "Invalid appsecret_proof", type: "OAuthException" },
          });
        }
        return json(200, {
          id: sub,
          name,
          ...(email !== "" && emailVerified === true && { email }),
        });
      }
    }
    return null;
  }

  const userPaths: Record<string, ProviderId> = {
    "/google/userinfo": "google",
    "/surveyjs/userinfo": "surveyjs",
    "/github-api/user": "github",
    "/github-api/user/emails": "github",
    "/facebook-graph/me": "facebook",
  };

  async function route(request: IncomingMessage): Promise<Reply> {
    const url = new URL(request.url ?? "/", origin);
    const path = url.pathname;
    const method = request.method ?? "GET";

    for (const [provider, config] of Object.entries(providers) as [ProviderId, ProviderConfig][]) {
      if (path === config.authorizePath && (method === "GET" || method === "POST")) {
        const params =
          method === "GET" ? url.searchParams : new URLSearchParams(await readBody(request));
        return authorize(provider, method, params);
      }
    }
    const tokenProvider = tokenPaths[path];
    if (tokenProvider !== undefined) {
      if (tokenProvider === "facebook" && method === "GET") {
        return token(tokenProvider, request, url.searchParams);
      }
      if (method === "POST" && tokenProvider !== "facebook") {
        return token(tokenProvider, request, new URLSearchParams(await readBody(request)));
      }
      return oauthError(405, "invalid_request");
    }
    const userProvider = userPaths[path];
    if (userProvider !== undefined && method === "GET") {
      return userEndpoint(userProvider, request, url, path) ?? oauthError(404, "not_found");
    }
    if (method === "GET") {
      switch (path) {
        case "/google/.well-known/openid-configuration":
          return json(200, metadata("google"));
        case "/google/jwks":
          return json(200, { keys: [jwk] });
        case "/surveyjs/.well-known/oauth-authorization-server":
        case "/.well-known/oauth-authorization-server/surveyjs":
          return json(200, metadata("surveyjs"));
      }
    }
    return oauthError(404, "not_found");
  }

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    route(request).then(
      ({ status, headers, body }) => response.writeHead(status, headers).end(body),
      () => response.writeHead(500).end(),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, resolve);
  });
  const { port } = server.address() as AddressInfo;
  origin = `http://${host.includes(":") ? `[${host}]` : host}:${port}`;

  return {
    url: origin,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
