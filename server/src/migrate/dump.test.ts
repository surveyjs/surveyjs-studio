import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDumpWriter } from "./dump.js";

describe("openDumpWriter", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const writeOne = async (dir: string) => {
    const dump = openDumpWriter(dir);
    await dump.write("event", {
      id: "00000000-0000-4000-8000-000000000001",
      surveyId: "00000000-0000-4000-8000-000000000002",
      type: "T",
      at: "2026-01-01T00:00:00.000Z",
      payload: null,
    });
    await dump.close();
  };

  it("appends one line per record, so a resumed run adds to the file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "surveyjs-studio-dump-test-"));
    dirs.push(dir);
    await writeOne(dir);
    await writeOne(dir);
    const lines = readFileSync(join(dir, "records.ndjson"), "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ kind: "event" });
  });

  // Windows keeps no POSIX modes: the owner-only mode is checked where it exists.
  it.skipIf(process.platform === "win32")(
    "creates the file readable by its owner only",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "surveyjs-studio-dump-test-"));
      dirs.push(dir);
      await writeOne(dir);
      expect(statSync(join(dir, "records.ndjson")).mode & 0o777).toBe(0o600);
    },
  );
});
