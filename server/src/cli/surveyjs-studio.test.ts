import { afterEach, describe, expect, it } from "vitest";
import { scratchSqlite, type ScratchDatabase } from "../sql/scratch-databases.js";
import { run } from "./surveyjs-studio.js";

function capture() {
  let out = "";
  let err = "";
  return {
    io: { out: (t: string) => (out += t), err: (t: string) => (err += t) },
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

describe("surveyjs-studio command", () => {
  const scratches: ScratchDatabase[] = [];
  afterEach(async () => {
    for (const scratch of scratches.splice(0)) await scratch.drop();
  });

  it("passes status on to the database command", async () => {
    const scratch = scratchSqlite();
    scratches.push(scratch);
    if (scratch.target.dialect !== "sqlite") throw new Error("unreachable");
    const env = { STORAGE_PROVIDER: "sqlite", SQLITE_PATH: scratch.target.path };
    const result = capture();
    expect(await run(["status"], result.io, { env })).toBe(0);
    expect(result.out).toMatch(/^Database: sqlite, .+test\.db\n/);
    expect(result.out).toContain("Applied: none");
  });

  it("refuses an unknown command or none, with the usage", async () => {
    const unknown = capture();
    expect(await run(["frobnicate"], unknown.io, { env: {} })).toBe(2);
    expect(unknown.err).toContain("Unknown command: frobnicate");
    expect(unknown.err).toContain("Usage: surveyjs-studio <command>");
    const none = capture();
    expect(await run([], none.io, { env: {} })).toBe(2);
    expect(none.err).toContain("Usage: surveyjs-studio <command>");
  });

  it("prints the usage for --help", async () => {
    const result = capture();
    expect(await run(["--help"], result.io, { env: {} })).toBe(0);
    expect(result.out).toContain("Usage: surveyjs-studio <command>");
    for (const command of ["backup", "restore", "migrate", "status", "seed", "s3-bucket"]) {
      expect(result.out).toContain(`  ${command}`);
    }
  });

  it("passes s3-bucket on with the rest of its arguments", async () => {
    const result = capture();
    expect(await run(["s3-bucket", "create", "Not_A_Bucket"], result.io, { env: {} })).toBe(2);
    expect(result.err).toContain("Not a bucket name: Not_A_Bucket");
  });

  it("passes backup on", async () => {
    const result = capture();
    expect(await run(["backup"], result.io, { env: { STORAGE_PROVIDER: "postgres" } })).toBe(2);
    expect(result.err).toContain("pg_dump");
  });
});
