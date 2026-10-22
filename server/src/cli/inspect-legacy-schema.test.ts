import { describe, expect, it } from "vitest";
import { formatFacts, run, type SchemaFacts } from "./inspect-legacy-schema.js";

const facts: SchemaFacts = {
  theme: { type: "nvarchar", length: 400, collation: "Latin1_General_CI_AS" },
  triggers: ["trg_a", "trg_b"],
  ispublished: { type: "bit", nullable: false, defaultDefinition: "((0))" },
  total: 10,
  emptyIspublished: 3,
};

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } };
}

describe("inspect-legacy-schema", () => {
  it("formats the four lines", () => {
    expect(formatFacts(facts)).toBe(
      [
        "Surveys.theme: nvarchar(200) COLLATE Latin1_General_CI_AS",
        "Surveys triggers: trg_a, trg_b",
        "Surveys.ispublished: bit, nullable no, default ((0))",
        "Surveys with an empty ispublished: 3 of 10",
        "",
      ].join("\n"),
    );
  });

  it("reports a missing column and no triggers", () => {
    const text = formatFacts({ ...facts, theme: null, ispublished: null, triggers: [] });
    expect(text).toContain("Surveys.theme: column not found");
    expect(text).toContain("Surveys triggers: none");
    expect(text).toContain("Surveys.ispublished: column not found");
  });

  it("exits 2 for a usage error, a missing env file and a missing connection string", async () => {
    for (const argv of [["--nope"], ["--env-file"], ["--env-file", "does-not-exist.env"], []]) {
      const { io } = capture();
      expect(await run(argv, io, { env: {} })).toBe(2);
    }
  });

  it("exits 1 with a message free of the connection string and the driver text", async () => {
    const { out, err, io } = capture();
    const code = await run([], io, {
      env: { LEGACY_SQL_CONNECTION_STRING: "Server=secret-host;Password=hunter2" },
      read: () => Promise.reject(new Error("Login failed for Server=secret-host Password=hunter2")),
    });
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err.join("")).not.toMatch(/secret-host|hunter2/);
  });
});
