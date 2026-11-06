// Mirrors server/src/handlers.ts (`getConfig`) and server/src/auth/session-handlers.ts
// (`getCurrentUser`, `logout`) for the demo's local directory (D3, D6).
import { HttpResponse } from "msw";
import type { SandboxData } from "../store";
import { SESSION_COOKIE } from "../store";
import { BODY_LIMITS } from "./common";
import type { HandlerContext } from "./context";
import { http } from "./http";
import { guarded, unauthenticated } from "./problems";

/**
 * The id of the seed user the `msid` cookie names, or null: no cookie, an id that is no user of
 * `data` (a reset, an older sandbox) or a blocked user.
 */
export function currentUserId(cookies: Record<string, string>, data: SandboxData): string | null {
  const raw = cookies[SESSION_COOKIE];
  if (raw === undefined || raw === "") return null;
  const wanted = raw.toLowerCase();
  const user = data.users.find((candidate) => candidate.id.toLowerCase() === wanted);
  return user && !user.blocked ? user.id : null;
}

/**
 * The SurveyJS licence key the sandbox build baked in (`VITE_SANDBOX_LICENSE_KEY`), or null when
 * the variable is unset or blank.
 */
export function sandboxLicenseKey(raw: string | undefined): string | null {
  const key = raw?.trim();
  return key ? key : null;
}

export function sessionHandlers(ctx: HandlerContext) {
  return [
    http.get("/config", () =>
      HttpResponse.json({
        edition: "self-hosted",
        shell: "self-hosted",
        authMethods: ["password"],
        surveyjsLicenseKey: sandboxLicenseKey(import.meta.env.VITE_SANDBOX_LICENSE_KEY),
        limits: {
          maxAssetBytesPerSurvey: ctx.settings.maxUploadKb * 1024,
          maxFileBytes: ctx.settings.maxUploadKb * 1024,
          ...BODY_LIMITS,
        },
        readOnly: false,
        branding: {
          name: "SurveyJS Studio demo",
          logoUrl: null,
          accentColor: "#19b394",
          termsUrl: null,
          privacyUrl: null,
          poweredBy: true,
        },
        features: { embed: false, apiDocs: false, apiTokens: false },
      }),
    ),

    http.get("/me", ({ cookies }) =>
      guarded(() => {
        const data = ctx.store.read();
        const id = currentUserId(cookies, data);
        const user = data.users.find((candidate) => candidate.id === id);
        if (!user) throw unauthenticated();
        return HttpResponse.json({
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          avatarUrl: null,
          hasPassword: false,
          notices: [],
        });
      }),
    ),

    // The web app clears the cookie (Task 8); the answer sends the browser to Pick an account.
    http.post("/auth/logout", () => HttpResponse.json({ redirectUrl: "/sign-in" })),
  ];
}
