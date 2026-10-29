import type { Kysely, Selectable } from "kysely";
import { GUID } from "../domain/guid.js";
import type { User } from "../domain/types.js";
import type { LocalAccount, LocalAccountStore, UserDirectory } from "../providers/types.js";
import type { SqlDatabase } from "./database.js";
import type { DatabaseSchema, UsersTable } from "./schema.js";
import { flagOf, isoOf } from "./values.js";

type UserRow = Selectable<UsersTable>;

const userOf = (row: Pick<UserRow, "id" | "email" | "display_name" | "status">): User => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  blocked: row.status === "disabled",
});

const accountOf = (row: UserRow): LocalAccount => ({
  user: userOf(row),
  instanceRole: row.instance_role,
  status: row.status,
  passwordHash: row.password_hash,
  mustChangePassword: flagOf(row.must_change_password),
  sessionEpoch: Number(row.session_epoch),
  lastSignInAt: row.last_sign_in_at === null ? null : isoOf(row.last_sign_in_at),
});

/** A GUID as stored (lower-case); null for a value that is not a GUID, which no row can have. */
const key = (id: string): string | null => (GUID.test(id) ? id.toLowerCase() : null);

/**
 * The users of `ids` that exist, by id, read through `db` (a transaction's, when the caller holds
 * one: Kysely's single SQLite connection could not serve a second query meanwhile).
 */
export async function usersById(
  db: Kysely<DatabaseSchema>,
  ids: readonly string[],
): Promise<Map<string, User>> {
  const wanted = [...new Set(ids.flatMap((id) => (GUID.test(id) ? [id.toLowerCase()] : [])))];
  if (wanted.length === 0) return new Map();
  const rows = await db
    .selectFrom("users")
    .select(["id", "email", "display_name", "status"])
    .where("id", "in", wanted)
    .execute();
  return new Map(rows.map((row) => [row.id, userOf(row)]));
}

export interface SqlLocalAccounts {
  readonly accounts: LocalAccountStore;
  /** The local user directory over the same table. */
  readonly users: UserDirectory;
}

/** The local accounts in the database's `users` table (USER_DIRECTORY=local). */
export function createSqlLocalAccounts(database: SqlDatabase): SqlLocalAccounts {
  const { db } = database;

  const byId = async (id: string): Promise<UserRow | undefined> => {
    const userId = key(id);
    if (userId === null) return undefined;
    return db.selectFrom("users").selectAll().where("id", "=", userId).executeTakeFirst();
  };
  const byEmail = async (email: string): Promise<UserRow | undefined> => {
    const wanted = email.toLowerCase();
    if (wanted.trim() === "") return undefined;
    return db.selectFrom("users").selectAll().where("email", "=", wanted).executeTakeFirst();
  };

  const accounts: LocalAccountStore = {
    countAccounts: async () => {
      const row = await db
        .selectFrom("users")
        .select((eb) => eb.fn.countAll<number | string | bigint>().as("n"))
        .executeTakeFirstOrThrow();
      return Number(row.n);
    },
    countActiveAdmins: async () => {
      const row = await db
        .selectFrom("users")
        .select((eb) => eb.fn.countAll<number | string | bigint>().as("n"))
        .where("instance_role", "=", "admin")
        .where("status", "=", "active")
        .executeTakeFirstOrThrow();
      return Number(row.n);
    },
    createAccount: async (account) => {
      const id = key(account.id);
      if (id === null) throw new Error("Account ids must be GUIDs");
      await db
        .insertInto("users")
        .values({
          id,
          email: account.email.toLowerCase(),
          display_name: account.displayName,
          instance_role: account.instanceRole,
          status: account.status,
          password_hash: account.passwordHash,
          must_change_password: account.mustChangePassword,
          session_epoch: 0,
          created_at: isoOf(account.createdAt),
          last_sign_in_at: null,
        })
        .execute();
      return accountOf((await byId(id))!);
    },
    account: async (id) => {
      const row = await byId(id);
      return row ? accountOf(row) : null;
    },
    accountByEmail: async (email) => {
      const row = await byEmail(email);
      return row ? accountOf(row) : null;
    },
    setPassword: async (id, passwordHash, { mustChange }) => {
      const userId = key(id);
      if (userId === null) return null;
      // One statement: the epoch is raised where it is, so two changes at once both count.
      const row = await db
        .updateTable("users")
        .set((eb) => ({
          password_hash: passwordHash,
          must_change_password: mustChange,
          session_epoch: eb("session_epoch", "+", 1),
          status: eb
            .case()
            .when("status", "=", "invited")
            .then("active" as const)
            .else(eb.ref("status"))
            .end(),
        }))
        .where("id", "=", userId)
        .returning("session_epoch")
        .executeTakeFirst();
      return row ? Number(row.session_epoch) : null;
    },
    recordSignIn: async (id, at) => {
      const userId = key(id);
      if (userId === null) return;
      await db
        .updateTable("users")
        .set({ last_sign_in_at: isoOf(at) })
        .where("id", "=", userId)
        .execute();
    },
    createPasswordLink: async ({ tokenHash, userId, purpose, createdAt, expiresAt }) => {
      await db
        .insertInto("password_links")
        .values({
          token_hash: tokenHash,
          user_id: userId.toLowerCase(),
          purpose,
          created_at: isoOf(createdAt),
          expires_at: isoOf(expiresAt),
          used_at: null,
        })
        .execute();
    },
    // One statement, so two uses at the same time cannot both find the link unused.
    usePasswordLink: async (tokenHash, at) => {
      const when = isoOf(at);
      const row = await db
        .updateTable("password_links")
        .set({ used_at: when })
        .where("token_hash", "=", tokenHash)
        .where("used_at", "is", null)
        .where("expires_at", ">", when)
        .returning("user_id")
        .executeTakeFirst();
      return row?.user_id ?? null;
    },
  };

  const users: UserDirectory = {
    kind: "local",
    getUser: async (id) => {
      const row = await byId(id);
      return row ? userOf(row) : null;
    },
    findUserByEmail: async (email) => {
      const row = await byEmail(email);
      return row ? userOf(row) : null;
    },
    // Password sign-in does not go through claims; an OAuth2 identity links here in Step 8.
    signInUser: async (claims) => {
      const row = await byId(claims.sub);
      return row ? userOf(row) : null;
    },
    missingUsers: async (ids) => {
      const asked = [...new Set(ids.flatMap((id) => (GUID.test(id) ? [id.toLowerCase()] : [])))];
      const known = await usersById(db, asked);
      return asked.filter((id) => !known.has(id));
    },
  };

  return { accounts, users };
}
