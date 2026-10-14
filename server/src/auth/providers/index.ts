import type { AppConfig } from "../../config.js";
import { legacyFixtureSeed } from "../../providers/azure-legacy/fixtures.js";
import type { IdentityProvider } from "../identity.js";
import { createDevIdentityProvider } from "./dev.js";
import { createOidcIdentityProvider } from "./oidc.js";

/** The configured identity provider. The dev provider lists the users of the memory seed. */
export async function createIdentityProvider(config: AppConfig): Promise<IdentityProvider> {
  if (config.identityProvider === "dev") {
    const users = config.memorySeed === "legacy-fixtures" ? (await legacyFixtureSeed()).users : [];
    return createDevIdentityProvider({ publicBaseUrl: config.publicBaseUrl, users });
  }
  return createOidcIdentityProvider(config.oidc);
}
