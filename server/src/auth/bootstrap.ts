import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../config.js";
import { hashPassword } from "../passwords/hash.js";
import type { LocalAccountStore } from "../providers/types.js";
import { publicUrl } from "./identity.js";

/** What the first-admin bootstrap left for the sign-in handlers. */
export interface Bootstrap {
  /** The setup link's token while the instance has no admin; null otherwise. Secret: never log. */
  readonly setupToken: string | null;
}

/**
 * Whether an active instance admin can sign in with a password. The seed's instance admin has no
 * password (the dev sign-in signs it in), and neither has an admin whose password was reset: the
 * first admin is still made while no such admin exists.
 */
export async function hasPasswordAdmin(accounts: LocalAccountStore): Promise<boolean> {
  return (await accounts.listAccounts()).some(
    (account) =>
      account.instanceRole === "admin" &&
      account.status === "active" &&
      account.passwordHash !== null,
  );
}

/**
 * The first admin of a local directory (spec: S4). Runs at start-up while no active admin has a
 * password (`hasPasswordAdmin`): with ADMIN_EMAIL and ADMIN_PASSWORD it creates that admin, who must change the password at
 * first sign-in; without them it writes a one-time setup link to the log, which creates the admin
 * with the email, name and password chosen on the setup page. The link lives in this process only:
 * a restart writes a new one while there is still no admin. READ_ONLY=true writes nothing.
 */
export async function bootstrapFirstAdmin(
  config: AppConfig,
  accounts: LocalAccountStore,
  log: FastifyBaseLogger,
  now: () => number = Date.now,
): Promise<Bootstrap> {
  if (config.readOnly || (await hasPasswordAdmin(accounts))) return { setupToken: null };
  const admin = config.bootstrapAdmin;
  if (admin !== null) {
    if (await accounts.accountByEmail(admin.email)) {
      log.warn(
        "ADMIN_EMAIL names an existing account, which was left as it is: no admin was created",
      );
      return { setupToken: null };
    }
    await accounts.createAccount({
      id: randomUUID(),
      email: admin.email,
      displayName: admin.email.split("@")[0] || admin.email,
      instanceRole: "admin",
      status: "active",
      passwordHash: await hashPassword(admin.password),
      mustChangePassword: true,
      createdAt: new Date(now()).toISOString(),
    });
    log.info(
      "created the first admin from ADMIN_EMAIL; the password must be changed at first sign-in",
    );
    return { setupToken: null };
  }
  const setupToken = randomBytes(24).toString("base64url");
  // The one place a secret is logged, on purpose: the operator opens it to create the admin.
  log.warn(
    `This instance has no admin yet. Open this one-time link to create the first one: ${publicUrl(config.publicBaseUrl, `/set-password?setup=${setupToken}`)}`,
  );
  return { setupToken };
}
