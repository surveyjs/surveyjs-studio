import type { AppConfig, ExternalMethod } from "../../config.js";
import { legacyFixtureSeed } from "../../providers/azure-legacy/fixtures.js";
import { seedInstanceAdmin } from "../../providers/seed-instance-admin.js";
import type { IdentityProvider } from "../identity.js";
import { createDevIdentityProvider } from "./dev.js";
import { facebookEndpoints, githubEndpoints, googleIssuer } from "./endpoints.js";
import { createFacebookIdentityProvider } from "./facebook.js";
import { createGithubIdentityProvider } from "./github.js";
import { createLocalIdentityProvider } from "./local.js";
import { createOidcIdentityProvider, verifiedUnlessFalse } from "./oidc.js";

/** The providers of one server: the one `login` without `provider` uses, and one per enabled method. */
export interface SignInProviders {
  /** Finishes a sign-in `login` started without `provider`; also ends the session on logout. */
  readonly primary: IdentityProvider;
  /**
   * The external method `primary` is (`surveyjs` when `login` goes straight to surveyjs.io); null
   * for the dev provider and the web app's sign-in page.
   */
  readonly primaryMethod: ExternalMethod | null;
  /** Each external method in AUTH_METHODS, for `login?provider=`. */
  readonly byMethod: ReadonlyMap<ExternalMethod, IdentityProvider>;
}

/** The configured sign-in providers. The dev provider lists the users of the memory seed. */
export async function createSignInProviders(config: AppConfig): Promise<SignInProviders> {
  const { publicBaseUrl, authMethods, oauthClients, oauthStubUrl } = config;
  const byMethod = new Map<ExternalMethod, IdentityProvider>();

  // loadConfig requires the OIDC settings for the surveyjs method unless identity rules are
  // skipped (tools that never serve HTTP) or the dev provider is on.
  if (authMethods.includes("surveyjs") && config.oidc) {
    byMethod.set(
      "surveyjs",
      createOidcIdentityProvider({
        oidc: config.oidc,
        publicBaseUrl,
        emailVerified: verifiedUnlessFalse,
      }),
    );
  }
  const { google, github, facebook } = oauthClients;
  if (authMethods.includes("google") && google) {
    byMethod.set(
      "google",
      createOidcIdentityProvider({
        oidc: {
          issuerUrl: googleIssuer(oauthStubUrl),
          clientId: google.clientId,
          clientSecret: google.clientSecret,
          discovery: "openid-configuration",
          scopes: "openid email profile",
        },
        publicBaseUrl,
        emailVerified: (userInfo) => userInfo.email_verified === true,
      }),
    );
  }
  if (authMethods.includes("github") && github) {
    byMethod.set(
      "github",
      createGithubIdentityProvider({
        client: github,
        publicBaseUrl,
        endpoints: githubEndpoints(oauthStubUrl),
      }),
    );
  }
  if (authMethods.includes("facebook") && facebook) {
    byMethod.set(
      "facebook",
      createFacebookIdentityProvider({
        client: facebook,
        publicBaseUrl,
        endpoints: facebookEndpoints(oauthStubUrl),
      }),
    );
  }

  return { ...(await primaryProvider(config, byMethod)), byMethod };
}

async function primaryProvider(
  config: AppConfig,
  byMethod: ReadonlyMap<ExternalMethod, IdentityProvider>,
): Promise<Omit<SignInProviders, "byMethod">> {
  if (config.identityProvider === "dev") {
    const seedUsers =
      config.memorySeed === "legacy-fixtures" ? (await legacyFixtureSeed()).users : [];
    // A local directory's seed has an instance admin too (Step 5).
    const users =
      config.userDirectory === "local" && seedUsers.length > 0
        ? [...seedUsers, seedInstanceAdmin]
        : seedUsers;
    return {
      primary: createDevIdentityProvider({ publicBaseUrl: config.publicBaseUrl, users }),
      primaryMethod: null,
    };
  }
  // Only surveyjs.io: `login` goes straight to it. Any other set of methods: the web app's
  // sign-in page, which offers them.
  if (config.authMethods.length === 1 && config.authMethods[0] === "surveyjs") {
    const surveyjs = byMethod.get("surveyjs");
    if (!surveyjs) throw new Error("IDENTITY_PROVIDER=surveyjs-oidc needs the OIDC_* settings");
    return { primary: surveyjs, primaryMethod: "surveyjs" };
  }
  return { primary: createLocalIdentityProvider(config.publicBaseUrl), primaryMethod: null };
}
