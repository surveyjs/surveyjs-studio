import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sandboxSeed, seedJson } from "./generate.js";

const root = resolve(import.meta.dirname, "../..");
const seedPath = resolve(root, "web/src/sandbox/seed.json");
const configPath = resolve(root, "web/sandbox-public/sandbox.config.json");

const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-a0000000000${n}`;
const user = (n: number) => id("11111111", n);
const survey = (n: number) => id("22222222", n);

const budgetKb = (): number => {
  if (!existsSync(configPath)) return 1024;
  const value = (JSON.parse(readFileSync(configPath, "utf8")) as { seedBudgetKb?: unknown })
    .seedBudgetKb;
  return typeof value === "number" && value > 0 ? value : 1024;
};

describe("the sandbox seed", () => {
  it("is the committed seed.json (run pnpm sandbox:seed when this fails)", async () => {
    expect(readFileSync(seedPath, "utf8"), "run pnpm sandbox:seed").toBe(
      seedJson(await sandboxSeed()),
    );
  });

  it("fits the budget", () => {
    expect(statSync(seedPath).size).toBeLessThanOrEqual(budgetKb() * 1024);
  });

  it("has the tagged users, surveys and projects", async () => {
    const seed = await sandboxSeed();
    expect(seed.version).toBe(1);
    expect(seed.users.map((u) => u.id).sort()).toEqual([1, 2, 3, 4].map(user));
    expect(seed.surveys.map((s) => s.id).sort()).toEqual([1, 2, 3, 4, 5, 6, 7].map(survey));
    expect(seed.projects).toHaveLength(2);
  });

  it("leaves out surveys a08 and a09 and users a05 and a06", async () => {
    const text = seedJson(await sandboxSeed());
    for (const n of [8, 9]) expect(text).not.toContain(survey(n));
    for (const n of [5, 6]) expect(text).not.toContain(user(n));
  });

  it("keeps the seed invitation and the a01 and a04 responses", async () => {
    const seed = await sandboxSeed();
    expect(seed.invitations).toEqual([
      expect.objectContaining({ email: "invited@example.com", role: "user" }),
    ]);
    const marketing = seed.projects.find((p) => p.name === "Marketing");
    expect(marketing).toBeDefined();
    expect(seed.invitations[0]?.projectId).toBe(marketing?.id);
    expect(seed.responses[survey(1)]?.length).toBeGreaterThan(0);
    expect(seed.responses[survey(4)]?.length).toBeGreaterThan(0);
  });

  it("points no membership or response at an excluded id", async () => {
    const seed = await sandboxSeed();
    const users = new Set(seed.users.map((u) => u.id));
    const projects = new Set(seed.projects.map((p) => p.id));
    const surveys = new Set(seed.surveys.map((s) => s.id));
    for (const m of seed.memberships) {
      expect(users.has(m.userId)).toBe(true);
      expect(projects.has(m.projectId)).toBe(true);
    }
    for (const i of seed.invitations) {
      expect(projects.has(i.projectId)).toBe(true);
      expect(users.has(i.invitedBy)).toBe(true);
    }
    for (const s of seed.surveys) {
      if (s.owner.kind === "personal") expect(users.has(s.owner.userId)).toBe(true);
      else expect(projects.has(s.owner.projectId)).toBe(true);
    }
    for (const p of seed.projects) if (p.creatorId) expect(users.has(p.creatorId)).toBe(true);
    for (const key of [
      "definitions",
      "themes",
      "history",
      "responses",
      "completions",
      "legacyViews",
      "privateResultQuestions",
    ] as const)
      for (const k of Object.keys(seed[key])) expect(surveys.has(k)).toBe(true);
  });
});
