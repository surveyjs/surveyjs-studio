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
 * The first admin of a local directory (spec: S4). READ_ONLY=true writes nothing.
 *
 * With passwords: runs at start-up while no active admin has a password (`hasPasswordAdmin`). With
 * ADMIN_EMAIL and ADMIN_PASSWORD it creates that admin, who must change the password at first
 * sign-in; without them it writes a one-time setup link to the log, which creates the admin with
 * the email, name and password chosen on the setup page. The link lives in this process only: a
 * restart writes a new one while there is still no admin.
 *
 * Without passwords: runs while there is no active instance admin at all. It creates the admin
 * from ADMIN_EMAIL, active and without a password; their first OAuth2 sign-in with that verified
 * email links to it (D3). It never writes a setup link, whose page needs passwords.
 */
export async function bootstrapFirstAdmin(
  config: AppConfig,
  accounts: LocalAccountStore,
  log: FastifyBaseLogger,
  now: () => number = Date.now,
): Promise<Bootstrap> {
  const none = { setupToken: null };
  if (config.readOnly) return none;
  const passwords = config.authMethods.includes("password");
  const hasAdmin = passwords
    ? await hasPasswordAdmin(accounts)
    : (await accounts.countActiveAdmins()) > 0;
  if (hasAdmin) return none;
  const admin = config.bootstrapAdmin;
  if (admin !== null) {
    if (await accounts.accountByEmail(admin.email)) {
      log.warn(
        "ADMIN_EMAIL names an existing account, which was left as it is: no admin was created",
      );
      return none;
    }
    const password = passwords ? admin.password : null;
    await accounts.createAccount({
      id: randomUUID(),
      email: admin.email,
      displayName: admin.email.split("@")[0] || admin.email,
      instanceRole: "admin",
      status: "active",
      passwordHash: password === null ? null : await hashPassword(password),
      mustChangePassword: password !== null,
      createdAt: new Date(now()).toISOString(),
    });
    log.info(
      password === null
        ? "created the first admin from ADMIN_EMAIL; they sign in with an OAuth2 method using that email"
        : "created the first admin from ADMIN_EMAIL; the password must be changed at first sign-in",
    );
    return none;
  }
  if (!passwords) return none;
  const setupToken = randomBytes(24).toString("base64url");
  // The one place a secret is logged, on purpose: the operator opens it to create the admin.
  log.warn(
    `This instance has no admin yet. Open this one-time link to create the first one: ${publicUrl(config.publicBaseUrl, `/set-password?setup=${setupToken}`)}`,
  );
  return { setupToken };
}
