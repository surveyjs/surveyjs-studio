import type { AppConfig } from "../../config.js";
import { legacyFixtureSeed } from "../../providers/azure-legacy/fixtures.js";
import type { IdentityProvider } from "../identity.js";
import { createDevIdentityProvider } from "./dev.js";
import { createLocalIdentityProvider } from "./local.js";
import { createOidcIdentityProvider } from "./oidc.js";

/** The configured identity provider. The dev provider lists the users of the memory seed. */
export async function createIdentityProvider(config: AppConfig): Promise<IdentityProvider> {
  if (config.identityProvider === "dev") {
    const users = config.memorySeed === "legacy-fixtures" ? (await legacyFixtureSeed()).users : [];
    return createDevIdentityProvider({ publicBaseUrl: config.publicBaseUrl, users });
  }
  // Without the surveyjs method there is no provider to redirect to: the web app's sign-in page.
  if (!config.authMethods.includes("surveyjs"))
    return createLocalIdentityProvider(config.publicBaseUrl);
  // loadConfig requires the OIDC settings for surveyjs-oidc unless identity rules are skipped
  // (tools that never serve HTTP).
  if (!config.oidc) throw new Error("IDENTITY_PROVIDER=surveyjs-oidc needs the OIDC_* settings");
  return createOidcIdentityProvider({ oidc: config.oidc, publicBaseUrl: config.publicBaseUrl });
}
