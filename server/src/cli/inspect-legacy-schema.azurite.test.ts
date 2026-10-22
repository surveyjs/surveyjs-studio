import { describe, expect, it } from "vitest";
import { replicaConfig } from "../legacy/replica-env.js";
import { run } from "./inspect-legacy-schema.js";

// Runs in the `providers-azurite` Vitest project, against the local replica
// (server/fixtures/legacy/sql/schema.sql). Read-only.

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } };
}

describe("inspect-legacy-schema on the replica", () => {
  it("prints the theme column, triggers, ispublished column and the empty-flag count", async () => {
    const { out, err, io } = capture();
    const code = await run([], io, { env: process.env });
    expect(err.join("")).toBe("");
    expect(code).toBe(0);
    const text = out.join("");
    expect(text).toMatch(/^Surveys\.theme: varchar\(max\) COLLATE \S+$/m);
    expect(text).toContain("Surveys triggers: none\n");
    expect(text).toContain("Surveys.ispublished: tinyint, nullable yes, default none\n");
    const counts = /empty ispublished: (\d+) of (\d+)/.exec(text);
    expect(counts).not.toBeNull();
    expect(Number(counts![2])).toBeGreaterThan(0);
    expect(Number(counts![1])).toBeLessThanOrEqual(Number(counts![2]));
    expect(text).not.toContain(replicaConfig().sqlConnectionString);
  });

  it("fails without echoing the connection string when the server cannot be reached", async () => {
    const secret = "Not-A-Real-Password-1";
    const { out, err, io } = capture();
    const code = await run([], io, {
      env: {
        LEGACY_SQL_CONNECTION_STRING: `Server=127.0.0.1,1;Database=x;User Id=sa;Password=${secret};Connect Timeout=2;Encrypt=false`,
      },
    });
    expect(code).toBe(1);
    expect(out.join("")).toBe("");
    expect(err.join("")).toMatch(/^Error: /);
    expect(err.join("")).not.toContain(secret);
    expect(err.join("")).not.toContain("127.0.0.1");
  });
});
