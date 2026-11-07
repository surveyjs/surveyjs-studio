import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMemoryProviders } from "../providers/memory.js";
import type { ProjectStore } from "../providers/types.js";
import { openDatabase, type SqlDatabase, type SqlDialectName } from "./database.js";
import { migrate } from "./migrator.js";
import { createSqlProjectStore, directoryLookup } from "./project-store.js";
import { scratchDatabase, type ScratchDatabase } from "./scratch-databases.js";

const NOW = { now: "2026-10-02T10:00:00.000Z" };

/** What the SQL project store must do beyond the provider suite: writes that run at the same time. */
export function describeSqlProjectStoreSuite(dialect: SqlDialectName): void {
  describe(`SQL project store: ${dialect}`, () => {
    const first = randomUUID();
    const second = randomUUID();
    let scratch: ScratchDatabase;
    let database: SqlDatabase;
    let projects: ProjectStore;
    beforeAll(async () => {
      scratch = await scratchDatabase(dialect);
      database = openDatabase(scratch.target);
      await migrate(database);
      const users = createMemoryProviders({
        users: [first, second].map((id, n) => ({
          id,
          email: `admin${String(n)}@example.com`,
          displayName: `Admin ${String(n)}`,
          blocked: false,
        })),
        surveys: [],
        projects: [],
        memberships: [],
      }).users;
      projects = createSqlProjectStore(database, directoryLookup(users));
    });
    afterAll(async () => {
      await database.close();
      await scratch.drop();
    });

    it("keeps one admin when both admins are demoted at the same time (R8)", async () => {
      for (let round = 0; round < 10; round++) {
        const project = randomUUID();
        await projects.createProject({
          id: project,
          name: "Two admins",
          creatorId: first,
          createdAt: NOW.now,
        });
        expect(await projects.addMember(project, second, "admin", NOW)).toBe("added");
        const outcomes = await Promise.all([
          projects.setMemberRole(project, first, "user", NOW),
          projects.setMemberRole(project, second, "user", NOW),
        ]);
        expect(outcomes.sort()).toEqual(["changed", "last-admin"]);
        const admins = (await projects.listMembers(project)).filter((m) => m.role === "admin");
        expect(admins).toHaveLength(1);
      }
    });
  });
}
