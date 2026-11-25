import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashCredential } from "../../credentials/format.js";
import type { ApiTokenRecord, CredentialStore } from "../types.js";

export interface CredentialsUnderTest {
  readonly store: CredentialStore;
  /** False when the store has no legacy keys to seed. */
  readonly seedsLegacyKeys: boolean;
  /** Adds the key as a new unrevoked row of the user: earlier keys keep working (SQL and memory alike). */
  seedLegacyKey(userId: string, key: string): Promise<void>;
  /** A project id a token may belong to: the SQL stores need a project row (foreign key). */
  newProjectId(): Promise<string>;
  close(): Promise<void>;
}

const CREATED = "2026-11-01T10:00:00.000Z";
const AT = "2026-11-02T10:00:00.000Z";
const LATER = "2026-11-03T10:00:00.000Z";

type NewToken = Omit<ApiTokenRecord, "lastUsedAt" | "revokedAt">;

const newToken = (over: Partial<NewToken> = {}): NewToken => ({
  id: randomUUID(),
  creatorId: randomUUID(),
  projectId: null,
  name: "CI",
  lastFour: "abcd",
  createdAt: CREATED,
  ...over,
});

const hashOf = (): string => hashCredential(`sjs_${randomUUID()}`, "api-token");

/** What every credential store does. `create` starts with no tokens. */
export function describeCredentialStoreSuite(
  name: string,
  create: () => Promise<CredentialsUnderTest>,
): void {
  describe(`credentials: ${name}`, () => {
    let under: CredentialsUnderTest;
    let store: CredentialStore;
    beforeAll(async () => {
      under = await create();
      store = under.store;
    });
    afterAll(async () => {
      await under.close();
    });

    it("stores a token and finds it by hash, not by another hash", async () => {
      const token = newToken({ lastFour: "wxyz" });
      const hash = hashOf();
      await store.createApiToken(token, hash);
      expect(await store.findApiToken(hash)).toEqual({
        ...token,
        lastUsedAt: null,
        revokedAt: null,
      });
      expect(await store.findApiToken(hashOf())).toBeNull();
    });

    it("gets a token by id in any case, revoked ones too, and null for an unknown id", async () => {
      const token = newToken({ projectId: await under.newProjectId() });
      await store.createApiToken(token, hashOf());
      const stored = { ...token, lastUsedAt: null, revokedAt: null };
      expect(await store.getApiToken(token.id)).toEqual(stored);
      expect(await store.getApiToken(token.id.toUpperCase())).toEqual(stored);
      await store.revokeApiToken(token.id, AT);
      expect(await store.getApiToken(token.id)).toEqual({ ...stored, revokedAt: AT });
      expect(await store.getApiToken(randomUUID())).toBeNull();
      expect(await store.getApiToken("legacy-key")).toBeNull();
    });

    it("gets a token by id after its hash was replaced", async () => {
      const token = newToken();
      await store.createApiToken(token, hashOf());
      expect(await store.replaceApiTokenHash(token.id, hashOf(), "new3")).toBe(true);
      expect(await store.getApiToken(token.id)).toMatchObject({ id: token.id, lastFour: "new3" });
    });

    it("lists a creator's tokens newest first, without project tokens and revoked ones", async () => {
      const creatorId = randomUUID();
      const older = newToken({ creatorId, createdAt: "2026-11-01T10:00:00.000Z" });
      const newer = newToken({ creatorId, createdAt: "2026-11-01T11:00:00.000Z" });
      const revoked = newToken({ creatorId });
      const inProject = newToken({ creatorId, projectId: await under.newProjectId() });
      for (const t of [older, newer, revoked, inProject]) await store.createApiToken(t, hashOf());
      expect(await store.revokeApiToken(revoked.id, AT)).toBe(true);
      const listed = await store.listApiTokens({ creatorId });
      expect(listed.map((t) => t.id)).toEqual([newer.id, older.id]);
      expect(await store.listApiTokens({ creatorId: randomUUID() })).toEqual([]);
    });

    it("lists a project's tokens, whoever created them", async () => {
      const projectId = await under.newProjectId();
      const a = newToken({ projectId });
      const b = newToken({ projectId });
      const revoked = newToken({ projectId });
      for (const t of [a, b, revoked]) await store.createApiToken(t, hashOf());
      await store.revokeApiToken(revoked.id, AT);
      await store.createApiToken(newToken({ projectId: await under.newProjectId() }), hashOf());
      const listed = await store.listApiTokens({ projectId });
      expect(listed.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    });

    it("matches ids in any case", async () => {
      const creatorId = randomUUID();
      const token = newToken({ creatorId });
      await store.createApiToken({ ...token, id: token.id.toUpperCase() }, hashOf());
      const listed = await store.listApiTokens({ creatorId: creatorId.toUpperCase() });
      expect(listed.map((t) => t.id)).toEqual([token.id]);
      expect(await store.revokeApiToken(token.id.toUpperCase(), AT)).toBe(true);
    });

    it("revoke hides the token from lists, but findApiToken shows revokedAt", async () => {
      const creatorId = randomUUID();
      const token = newToken({ creatorId });
      const hash = hashOf();
      await store.createApiToken(token, hash);
      expect(await store.revokeApiToken(token.id, AT)).toBe(true);
      expect(await store.listApiTokens({ creatorId })).toEqual([]);
      expect(await store.findApiToken(hash)).toMatchObject({ id: token.id, revokedAt: AT });
    });

    it("answers false when revoking an unknown or already revoked token, and keeps the first time", async () => {
      const token = newToken();
      const hash = hashOf();
      await store.createApiToken(token, hash);
      expect(await store.revokeApiToken(randomUUID(), AT)).toBe(false);
      expect(await store.revokeApiToken(token.id, AT)).toBe(true);
      expect(await store.revokeApiToken(token.id, LATER)).toBe(false);
      expect(await store.findApiToken(hash)).toMatchObject({ revokedAt: AT });
    });

    it("replaces the hash and last four: the old hash finds nothing, the new one the same id", async () => {
      const token = newToken({ lastFour: "old1" });
      const oldHash = hashOf();
      const newHash = hashOf();
      await store.createApiToken(token, oldHash);
      expect(await store.replaceApiTokenHash(token.id, newHash, "new2")).toBe(true);
      expect(await store.findApiToken(oldHash)).toBeNull();
      expect(await store.findApiToken(newHash)).toMatchObject({ id: token.id, lastFour: "new2" });
      expect(await store.replaceApiTokenHash(randomUUID(), hashOf(), "zzzz")).toBe(false);
    });

    it("touch sets lastUsedAt", async () => {
      const token = newToken();
      const hash = hashOf();
      await store.createApiToken(token, hash);
      await store.touchApiToken(token.id, AT);
      expect(await store.findApiToken(hash)).toMatchObject({ lastUsedAt: AT });
      await store.touchApiToken(randomUUID(), AT);
    });

    it("revokes every unrevoked token of a creator, project tokens too, and counts them", async () => {
      const creatorId = randomUUID();
      const other = newToken();
      const mine = newToken({ creatorId });
      const inProject = newToken({ creatorId, projectId: await under.newProjectId() });
      const already = newToken({ creatorId });
      const hashes = [hashOf(), hashOf(), hashOf(), hashOf()];
      await store.createApiToken(mine, hashes[0]!);
      await store.createApiToken(inProject, hashes[1]!);
      await store.createApiToken(already, hashes[2]!);
      await store.createApiToken(other, hashes[3]!);
      await store.revokeApiToken(already.id, AT);
      expect(await store.revokeApiTokensOfCreator(creatorId, LATER)).toBe(2);
      expect(await store.findApiToken(hashes[0]!)).toMatchObject({ revokedAt: LATER });
      expect(await store.findApiToken(hashes[1]!)).toMatchObject({ revokedAt: LATER });
      expect(await store.findApiToken(hashes[2]!)).toMatchObject({ revokedAt: AT });
      expect(await store.findApiToken(hashes[3]!)).toMatchObject({ revokedAt: null });
      expect(await store.revokeApiTokensOfCreator(creatorId, LATER)).toBe(0);
    });

    it("revokes every unrevoked token of a project and counts them", async () => {
      const projectId = await under.newProjectId();
      const a = newToken({ projectId });
      const b = newToken({ projectId });
      const elsewhere = newToken({ projectId: await under.newProjectId() });
      const personal = newToken({ creatorId: a.creatorId });
      const hashes = [hashOf(), hashOf(), hashOf(), hashOf()];
      await store.createApiToken(a, hashes[0]!);
      await store.createApiToken(b, hashes[1]!);
      await store.createApiToken(elsewhere, hashes[2]!);
      await store.createApiToken(personal, hashes[3]!);
      await store.revokeApiToken(b.id, AT);
      expect(await store.revokeApiTokensOfProject(projectId, LATER)).toBe(1);
      expect(await store.findApiToken(hashes[0]!)).toMatchObject({ revokedAt: LATER });
      expect(await store.findApiToken(hashes[1]!)).toMatchObject({ revokedAt: AT });
      expect(await store.findApiToken(hashes[2]!)).toMatchObject({ revokedAt: null });
      expect(await store.findApiToken(hashes[3]!)).toMatchObject({ revokedAt: null });
    });

    describe("legacy keys", () => {
      const legacy = (): boolean => under?.seedsLegacyKeys ?? false;
      // The flag is known only after `create`, so the cases decide at run time.
      const legacyIt = (title: string, body: () => Promise<void>): void => {
        it(title, async (context) => {
          if (!legacy()) context.skip();
          await body();
        });
      };

      legacyIt("finds a seeded key in any letter case, with its owner", async () => {
        const userId = randomUUID();
        const key = `ab${randomUUID().replaceAll("-", "")}`;
        await under.seedLegacyKey(userId, key);
        expect(await store.findLegacyKey(key.toUpperCase())).toEqual({ userId, revoked: false });
        expect(await store.findLegacyKey(key)).toEqual({ userId, revoked: false });
        expect(await store.findLegacyKey("ffffffff")).toBeNull();
        expect(await store.legacyKeyOf(userId)).toEqual({
          lastFour: key.slice(-4),
          revoked: false,
        });
      });

      legacyIt("revokes the key: find and legacyKeyOf say revoked", async () => {
        const userId = randomUUID();
        const key = `cd${randomUUID().replaceAll("-", "")}`;
        await under.seedLegacyKey(userId, key);
        expect(await store.revokeLegacyKey(userId, AT)).toBe(true);
        expect(await store.findLegacyKey(key)).toEqual({ userId, revoked: true });
        expect(await store.legacyKeyOf(userId)).toMatchObject({ revoked: true });
      });

      legacyIt("a user without a key has none and cannot revoke", async () => {
        const userId = randomUUID();
        expect(await store.legacyKeyOf(userId)).toBeNull();
        expect(await store.revokeLegacyKey(userId, AT)).toBe(false);
      });

      // Providers that cannot replace a key (the old service's) do not offer the method.
      const replaceIt = (title: string, body: () => Promise<void>): void => {
        it(title, async (context) => {
          if (!legacy() || store.replaceLegacyKey === undefined) context.skip();
          await body();
        });
      };
      const newKey = (): string => randomUUID().replaceAll("-", "");

      replaceIt("finds a key stored in mixed case", async () => {
        const userId = randomUUID();
        const key = newKey();
        await under.seedLegacyKey(userId, key.slice(0, 16).toUpperCase() + key.slice(16));
        expect(await store.findLegacyKey(key)).toEqual({ userId, revoked: false });
      });

      const hashOf = (value: string): string => hashCredential(value, "legacy-key");

      replaceIt("replaces the key: the old one is revoked, the new one is the user's", async () => {
        const userId = randomUUID();
        const oldKey = newKey();
        const next = newKey();
        await under.seedLegacyKey(userId, oldKey);
        const replace = store.replaceLegacyKey!;
        expect(
          await replace(userId, hashOf(oldKey.toUpperCase()), hashOf(next), next.slice(-4), LATER),
        ).toBe(true);
        expect(await store.findLegacyKey(oldKey)).toEqual({ userId, revoked: true });
        expect(await store.findLegacyKey(next.toUpperCase())).toEqual({ userId, revoked: false });
        expect(await store.legacyKeyOf(userId)).toEqual({
          lastFour: next.slice(-4),
          revoked: false,
        });
        // The replaced key cannot rotate its successor away.
        const stale = newKey();
        expect(await replace(userId, hashOf(oldKey), hashOf(stale), "abcd", LATER)).toBe(false);
        expect(await store.findLegacyKey(stale)).toBeNull();
        expect(await store.legacyKeyOf(userId)).toMatchObject({ lastFour: next.slice(-4) });
        // The new key can be revoked, and then cannot be replaced.
        expect(await store.revokeLegacyKey(userId, LATER)).toBe(true);
        expect(await store.findLegacyKey(next)).toEqual({ userId, revoked: true });
        const again = newKey();
        expect(await replace(userId, hashOf(next), hashOf(again), "abcd", LATER)).toBe(false);
        expect(await store.findLegacyKey(again)).toBeNull();
      });

      replaceIt("revokes the user's other unrevoked keys too, whichever key replaces", async () => {
        for (const presented of [0, 1]) {
          const userId = randomUUID();
          const keys = [newKey(), newKey()];
          for (const k of keys) await under.seedLegacyKey(userId, k);
          const next = newKey();
          expect(
            await store.replaceLegacyKey!(
              userId,
              hashOf(keys[presented]!),
              hashOf(next),
              next.slice(-4),
              LATER,
            ),
          ).toBe(true);
          for (const k of keys)
            expect(await store.findLegacyKey(k)).toEqual({ userId, revoked: true });
          expect(await store.findLegacyKey(next)).toEqual({ userId, revoked: false });
          expect(await store.legacyKeyOf(userId)).toEqual({
            lastFour: next.slice(-4),
            revoked: false,
          });
        }
      });

      replaceIt("does not replace a revoked key, nor for a user without one", async () => {
        const userId = randomUUID();
        const key = newKey();
        await under.seedLegacyKey(userId, key);
        await store.revokeLegacyKey(userId, AT);
        const next = newKey();
        expect(
          await store.replaceLegacyKey!(userId, hashOf(key), hashOf(next), next.slice(-4), LATER),
        ).toBe(false);
        expect(await store.findLegacyKey(next)).toBeNull();
        expect(
          await store.replaceLegacyKey!(
            randomUUID(),
            hashOf(key),
            hashOf(next),
            next.slice(-4),
            LATER,
          ),
        ).toBe(false);
      });

      replaceIt("lets exactly one of two concurrent replaces of the same key win", async () => {
        const userId = randomUUID();
        const key = newKey();
        await under.seedLegacyKey(userId, key);
        const [a, b] = [newKey(), newKey()];
        const results = await Promise.all(
          [a, b].map((k) =>
            store.replaceLegacyKey!(userId, hashOf(key), hashOf(k), k.slice(-4), LATER),
          ),
        );
        expect(results.filter(Boolean)).toHaveLength(1);
        const found = await Promise.all([a, b].map((k) => store.findLegacyKey(k)));
        expect(found.filter((m) => m !== null && !m.revoked)).toHaveLength(1);
      });

      replaceIt("leaves no working key when a revoke races a replace", async () => {
        const userId = randomUUID();
        const key = newKey();
        await under.seedLegacyKey(userId, key);
        const next = newKey();
        await Promise.all([
          store.revokeLegacyKey(userId, LATER),
          store.replaceLegacyKey!(userId, hashOf(key), hashOf(next), next.slice(-4), LATER),
        ]);
        expect(await store.legacyKeyOf(userId)).toMatchObject({ revoked: true });
        for (const k of [key, next]) {
          const found = await store.findLegacyKey(k);
          expect(found === null || found.revoked).toBe(true);
        }
      });
    });
  });
}
