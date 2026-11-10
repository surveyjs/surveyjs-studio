import { randomBytes, randomUUID } from "node:crypto";
import type { components } from "@surveyjs-studio/contract";
import type { EraseAccount } from "../accounts/erasure.js";
import type { RequestUser } from "../auth/authenticate.js";
import { publicUrl } from "../auth/identity.js";
import { linkTokenHash } from "../auth/password-handlers.js";
import type { SessionCheck } from "../auth/session-check.js";
import type { Clock } from "../auth/session.js";
import type { ExternalMethod } from "../config.js";
import { AppError } from "../errors.js";
import { decodeUsersCursor, encodeUsersCursor } from "../paging/cursor.js";
import type {
  AccountChange,
  IdentityLink,
  InstanceRole,
  LocalAccount,
  LocalAccountStore,
  PendingPasswordLink,
} from "../providers/types.js";
import { notFound } from "../surveys/access.js";

type AdminUser = components["schemas"]["AdminUser"];
type AdminUserPage = components["schemas"]["AdminUserPage"];
type PasswordLink = components["schemas"]["PasswordLink"];
type CreatedUser = components["schemas"]["CreatedUser"];
type LinkedIdentityList = components["schemas"]["LinkedIdentityList"];

/** A set-password link works for 7 days (spec: Set-password links). */
export const LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export interface AdminServiceOptions {
  readonly publicBaseUrl: string;
  readonly accounts: LocalAccountStore;
  readonly sessionCheck: SessionCheck;
  readonly eraseAccount: EraseAccount;
  readonly now?: Clock;
}

export interface AdminUserCreate {
  readonly email: string;
  readonly displayName: string;
  readonly instanceRole?: InstanceRole;
}

export interface AdminService {
  list(user: RequestUser, query: { limit: number; cursor?: string }): Promise<AdminUserPage>;
  create(user: RequestUser, body: AdminUserCreate): Promise<CreatedUser>;
  update(user: RequestUser, userId: string, change: AccountChange): Promise<AdminUser>;
  delete(user: RequestUser, userId: string): Promise<void>;
  resetLink(user: RequestUser, userId: string): Promise<PasswordLink>;
  listIdentities(user: RequestUser, userId: string): Promise<LinkedIdentityList>;
  unlinkIdentity(
    user: RequestUser,
    userId: string,
    provider: ExternalMethod,
    subject: string,
  ): Promise<void>;
}

const adminUserJson = (
  account: LocalAccount,
  pendingLink: PendingPasswordLink | undefined,
): AdminUser => ({
  id: account.user.id,
  email: account.user.email,
  displayName: account.user.displayName,
  instanceRole: account.instanceRole,
  status: account.status,
  hasPassword: account.passwordHash !== null,
  pendingLink: pendingLink
    ? { purpose: pendingLink.purpose, expiresAt: pendingLink.expiresAt }
    : null,
  createdAt: account.createdAt,
  lastSignInAt: account.lastSignInAt,
});

const identityJson = (link: IdentityLink): LinkedIdentityList["items"][number] => ({
  provider: link.provider,
  subject: link.subject,
  email: link.email,
  linkedAt: link.createdAt,
});

const forbidden = (): AppError =>
  new AppError({
    code: "forbidden",
    status: 403,
    title: "Forbidden",
    detail: "Only instance admins can do this.",
  });

const lastInstanceAdmin = (): AppError =>
  new AppError({
    code: "last-instance-admin",
    status: 409,
    title: "Last instance admin",
    detail: "The instance must keep at least one active admin.",
  });

const ownReset = (): AppError =>
  new AppError({
    code: "forbidden",
    status: 403,
    title: "Forbidden",
    detail: "You cannot reset your own password. Change it in your account, or ask another admin.",
  });

const emailTaken = (): AppError =>
  new AppError({
    code: "email-taken",
    status: 409,
    title: "Email taken",
    detail: "An account with this email exists.",
  });

/** The instance admin's user management (S12–S16, S18). Every operation is for instance admins. */
export function createAdminService(options: AdminServiceOptions): AdminService {
  const { accounts, sessionCheck, eraseAccount } = options;
  const now = options.now ?? Date.now;
  const nowIso = () => new Date(now()).toISOString();

  const requireInstanceAdmin = (user: RequestUser) => {
    if (user.instanceRole !== "admin") throw forbidden();
  };

  /** A new link: 128 random bits, of which only the hash is stored. */
  const newLink = () => {
    const token = randomBytes(16).toString("base64url");
    const createdAt = nowIso();
    const expiresAt = new Date(now() + LINK_LIFETIME_MS).toISOString();
    const url = new URL(publicUrl(options.publicBaseUrl, "/set-password"));
    url.searchParams.set("token", token);
    return {
      stored: { tokenHash: linkTokenHash(token), createdAt, expiresAt },
      json: { url: url.toString(), expiresAt },
    };
  };

  /** The account as the admin API shows it, with its pending link read now. */
  const withPendingLink = async (account: LocalAccount): Promise<AdminUser> =>
    adminUserJson(account, (await accounts.pendingPasswordLinks(nowIso())).get(account.user.id));

  return {
    async list(user, { limit, cursor }) {
      requireInstanceAdmin(user);
      const after = cursor === undefined ? undefined : decodeUsersCursor(cursor);
      const [all, pending] = await Promise.all([
        accounts.listAccounts(),
        accounts.pendingPasswordLinks(nowIso()),
      ]);
      const rest = after
        ? all.filter(
            ({ user: { email, id } }) =>
              email > after.email || (email === after.email && id > after.id),
          )
        : all;
      const items = rest.slice(0, limit);
      const last = items.at(-1);
      return {
        items: items.map((account) => adminUserJson(account, pending.get(account.user.id))),
        nextCursor:
          last !== undefined && rest.length > limit
            ? encodeUsersCursor({ email: last.user.email, id: last.user.id })
            : null,
      };
    },

    async create(user, { email, displayName, instanceRole = "user" }) {
      requireInstanceAdmin(user);
      if (await accounts.accountByEmail(email)) throw emailTaken();
      const link = newLink();
      const stored = { ...link.stored, purpose: "invitation" as const };
      let account: LocalAccount;
      try {
        // One write: the account and its link are stored together, or neither is.
        account = await accounts.createAccount(
          {
            id: randomUUID(),
            email,
            displayName,
            instanceRole,
            status: "invited",
            passwordHash: null,
            mustChangePassword: false,
            createdAt: nowIso(),
          },
          { link: stored },
        );
      } catch (error) {
        // Created at the same time by another request: the email is taken now.
        if (await accounts.accountByEmail(email)) throw emailTaken();
        throw error;
      }
      return { user: adminUserJson(account, stored), link: link.json };
    },

    async update(user, userId, change) {
      requireInstanceAdmin(user);
      const result = await accounts.updateAccount(userId, change);
      if (result.outcome === "not-found") throw notFound();
      if (result.outcome === "last-instance-admin") throw lastInstanceAdmin();
      // A disabled account or a changed role reaches the user's sessions at once on this server.
      sessionCheck.forget(result.account.user.id);
      return withPendingLink(result.account);
    },

    async delete(user, userId) {
      requireInstanceAdmin(user);
      // First the account stops signing in: disabled, its sessions ended. The store applies the
      // last-instance-admin rule atomically, so the last admin's data is never erased. Should the
      // erasure fail, the account stays disabled and the delete can be tried again.
      const disabled = await accounts.updateAccount(userId, { status: "disabled" });
      if (disabled.outcome === "not-found") throw notFound();
      if (disabled.outcome === "last-instance-admin") throw lastInstanceAdmin();
      const { id } = disabled.account.user;
      sessionCheck.forget(id);
      await eraseAccount(id, { now: nowIso() });
      const outcome = await accounts.deleteAccount(id);
      if (outcome === "last-instance-admin") throw lastInstanceAdmin();
      sessionCheck.forget(id);
    },

    async resetLink(user, userId) {
      requireInstanceAdmin(user);
      // It would end the admin's own session at once, and with it the page that shows the link.
      if (userId.toLowerCase() === user.id.toLowerCase()) throw ownReset();
      const link = newLink();
      const epoch = await accounts.resetPassword(userId, link.stored);
      if (epoch === null) throw notFound();
      sessionCheck.forget(userId);
      return link.json;
    },

    async listIdentities(user, userId) {
      requireInstanceAdmin(user);
      if (!(await accounts.account(userId))) throw notFound();
      return { items: (await accounts.listIdentities(userId)).map(identityJson) };
    },

    async unlinkIdentity(user, userId, provider, subject) {
      requireInstanceAdmin(user);
      const epoch = await accounts.unlinkIdentity(userId, provider, subject);
      if (epoch === null) throw notFound();
      // The account's sessions end at once on this server (the epoch went up).
      sessionCheck.forget(userId);
    },
  };
}
