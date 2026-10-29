import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserDirectory, UserDirectoryKind } from "../types.js";
import {
  BLOCKED_ID,
  ERASABLE_ID,
  OWNER_ID,
  UNKNOWN_ID,
  blockedUser,
  erasableUser,
  fixtureUsers,
  ownerUser,
} from "./expected.js";

export interface UserDirectoryHandle {
  readonly users: UserDirectory;
  close(): Promise<void>;
}

/**
 * The `users.*` sections, for a directory that holds the golden fixture users. `kind` is the
 * directory's: `external` (memory, surveyjs-sql, surveyjs-api) or `local` (USER_DIRECTORY=local).
 */
export function describeUserDirectorySections(
  users: () => UserDirectory,
  kind: UserDirectoryKind = "external",
): void {
  describe("users.kind", () => {
    it(`is ${kind}`, () => {
      expect(users().kind).toBe(kind);
    });
  });

  describe("users.getUser", () => {
    it.each(fixtureUsers.map((user) => [user.email, user] as const))(
      "returns the expected user %s",
      async (_email, user) => {
        expect(await users().getUser(user.id)).toEqual(user);
      },
    );

    it("returns null for an unknown id", async () => {
      expect(await users().getUser(UNKNOWN_ID)).toBeNull();
    });

    it("matches ids case-insensitively and returns lower-case ids", async () => {
      expect(await users().getUser(OWNER_ID.toUpperCase())).toEqual(ownerUser);
    });

    it("returns null for an id that is not a GUID", async () => {
      expect(await users().getUser("not-a-guid")).toBeNull();
    });
  });

  describe("users.findUserByEmail", () => {
    it("finds a user by email, ignoring case", async () => {
      expect(await users().findUserByEmail("owner@example.com")).toEqual(ownerUser);
      expect(await users().findUserByEmail("OWNER@Example.COM")).toEqual(ownerUser);
      expect(await users().findUserByEmail("ERASABLE@example.com")).toEqual(erasableUser);
    });

    it("returns null for an unknown email", async () => {
      expect(await users().findUserByEmail("nobody@example.com")).toBeNull();
    });

    it("returns null for a blank email", async () => {
      expect(await users().findUserByEmail("")).toBeNull();
      expect(await users().findUserByEmail("  ")).toBeNull();
    });
  });

  describe("users.signInUser", () => {
    it("returns the directory's user, whatever the claims say", async () => {
      expect(
        await users().signInUser({ sub: OWNER_ID, email: "other@example.test", name: "Other" }),
      ).toEqual(ownerUser);
    });

    it("matches the subject case-insensitively", async () => {
      expect(await users().signInUser({ sub: OWNER_ID.toUpperCase() })).toEqual(ownerUser);
    });

    it("returns a blocked user (the caller refuses them)", async () => {
      expect(await users().signInUser({ sub: BLOCKED_ID })).toEqual(blockedUser);
    });

    it("returns null for an unknown user and never creates one", async () => {
      expect(await users().signInUser({ sub: UNKNOWN_ID, email: "new@example.test" })).toBeNull();
      expect(await users().getUser(UNKNOWN_ID)).toBeNull();
    });
  });

  describe("users.missingUsers", () => {
    it("reports nothing for no ids", async () => {
      expect(await users().missingUsers([])).toEqual([]);
    });

    it("reports nothing for the fixture users", async () => {
      expect(await users().missingUsers(fixtureUsers.map((user) => user.id))).toEqual([]);
    });

    it("reports unknown ids once, lower-case, ignoring known ids and case", async () => {
      expect(
        await users().missingUsers([
          OWNER_ID,
          UNKNOWN_ID,
          ERASABLE_ID.toUpperCase(),
          UNKNOWN_ID.toUpperCase(),
        ]),
      ).toEqual([UNKNOWN_ID]);
    });

    it("never reports an id that is not a GUID", async () => {
      expect(await users().missingUsers(["not-a-guid", OWNER_ID])).toEqual([]);
    });

    it("answers for more ids than one query holds, in input order", async () => {
      const unknown = Array.from({ length: 149 }, () => randomUUID());
      const ids = [...unknown.slice(0, 75), OWNER_ID, ...unknown.slice(75)];
      expect(await users().missingUsers(ids)).toEqual(unknown);
    });
  });
}

/** A top-level suite with its own directory (the stub run of Task 3). */
export function describeUserDirectorySuite(
  name: string,
  create: () => Promise<UserDirectoryHandle>,
): void {
  describe(`user directory suite: ${name}`, () => {
    let handle: UserDirectoryHandle;
    beforeAll(async () => {
      handle = await create();
    });
    afterAll(async () => {
      await handle.close();
    });

    describeUserDirectorySections(() => handle.users);
  });
}
