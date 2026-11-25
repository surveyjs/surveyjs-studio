import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqlDatabase, type SqlDialectName } from "../sql/database.js";
import { migrate } from "../sql/migrator.js";
import { scratchDatabase, type ScratchDatabase } from "../sql/scratch-databases.js";
import { createMigrationState, type MigrationState } from "./state.js";

/** The migration tool's state store on one dialect. */
export function describeMigrationStateSuite(dialect: SqlDialectName): void {
  describe(`migration state: ${dialect}`, () => {
    let scratch: ScratchDatabase;
    let database: SqlDatabase;
    let state: MigrationState;
    beforeAll(async () => {
      scratch = await scratchDatabase(dialect);
      database = openDatabase(scratch.target);
      await migrate(database);
      state = createMigrationState(database.db, dialect);
    });
    afterAll(async () => {
      await database.close();
      await scratch.drop();
    });
    beforeEach(async () => {
      await state.clear();
    });

    it("gives null for a key that was never set", async () => {
      expect(await state.get("run")).toBeNull();
    });

    it("round-trips nested JSON", async () => {
      const value = {
        id: "r1",
        sample: { share: 0.25, include: ["a", "b"] },
        none: null,
        text: "caf\u00e9 \u{1F600}",
      };
      await state.set("run", value, "2026-11-25T10:00:00.000Z");
      expect(await state.get("run")).toEqual(value);
    });

    it("replaces the value of a second set", async () => {
      await state.set("marks", { a: 1, b: 2 }, "2026-11-25T10:00:00.000Z");
      await state.set("marks", { c: 3 }, "2026-11-25T11:00:00.000Z");
      expect(await state.get("marks")).toEqual({ c: 3 });
      expect(await state.keys("")).toEqual(["marks"]);
    });

    it("lists only the keys with the prefix, sorted", async () => {
      const at = "2026-11-25T10:00:00.000Z";
      await state.set("survey:b", { copiedAt: at }, at);
      await state.set("survey:a", { copiedAt: at }, at);
      await state.set("run", {}, at);
      await state.set("surveys", {}, at);
      expect(await state.keys("survey:")).toEqual(["survey:a", "survey:b"]);
    });

    it("treats LIKE wildcards in the prefix as text", async () => {
      const at = "2026-11-25T10:00:00.000Z";
      await state.set("a_b", {}, at);
      await state.set("axb", {}, at);
      await state.set("a%", {}, at);
      expect(await state.keys("a_")).toEqual(["a_b"]);
      expect(await state.keys("a%")).toEqual(["a%"]);
    });

    it("clears everything", async () => {
      const at = "2026-11-25T10:00:00.000Z";
      await state.set("run", {}, at);
      await state.set("survey:a", {}, at);
      await state.clear();
      expect(await state.keys("")).toEqual([]);
      expect(await state.get("run")).toBeNull();
    });
  });
}
