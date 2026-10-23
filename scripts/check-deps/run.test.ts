import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REQUIRED_DOCKERIGNORE } from "./dockerfile.js";
import { run } from "./run.js";

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "check-deps-"));
  dirs.push(root);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  return root;
}

const workspace = "packages:\n  - web\n";
const pkg = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });

describe("run", () => {
  it("reports OK for a clean repo", () => {
    const root = fixture({
      "pnpm-workspace.yaml": workspace,
      "package.json": pkg({ zod: "^4.0.0" }),
      "web/package.json": pkg({ react: "19.2.0" }),
    });
    expect(run(root)).toEqual({ code: 0, stdout: ["check:deps OK (2 manifests)"], stderr: [] });
  });

  it("exits 1 and prints file, dependency, version and rule for violations", () => {
    const root = fixture({
      "pnpm-workspace.yaml": workspace,
      "package.json": pkg({}),
      "web/package.json": pkg({ react: "^19.0.0" }),
    });
    expect(run(root)).toEqual({
      code: 1,
      stdout: [],
      stderr: ["web/package.json: react@^19.0.0 violates core-dependency-must-be-exact"],
    });
  });

  it("reports malformed JSON on one line", () => {
    const root = fixture({
      "pnpm-workspace.yaml": workspace,
      "package.json": pkg({}),
      "web/package.json": "{ nope",
    });
    expect(run(root)).toEqual({
      code: 1,
      stdout: [],
      stderr: ["check:deps error: web/package.json: malformed JSON"],
    });
  });

  it("reports a missing workspace package", () => {
    const root = fixture({ "pnpm-workspace.yaml": workspace, "package.json": pkg({}) });
    expect(run(root)).toEqual({
      code: 1,
      stdout: [],
      stderr: [
        "check:deps error: web/package.json: cannot read file (does the workspace package exist?)",
      ],
    });
  });

  it("reports a missing pnpm-workspace.yaml", () => {
    const root = fixture({ "package.json": pkg({}) });
    expect(run(root).stderr).toEqual(["check:deps error: pnpm-workspace.yaml: cannot read file"]);
  });

  it.each([
    ["packages: [web, server]\n", "flow style"],
    ["packages:\n  - packages/*\n", "glob entry"],
    ['packages:\n  - "web/**"\n', "glob entry"],
  ])("fails loudly on unsupported workspace syntax %j", (yaml, what) => {
    const root = fixture({ "pnpm-workspace.yaml": yaml, "package.json": pkg({}) });
    const result = run(root);
    expect(result.code).toBe(1);
    expect(result.stderr).toHaveLength(1);
    expect(result.stderr[0]).toContain(what);
  });
});

describe("run: Dockerfile node version", () => {
  const base = {
    "pnpm-workspace.yaml": workspace,
    "package.json": pkg({}),
    "web/package.json": pkg({}),
    ".dockerignore": REQUIRED_DOCKERIGNORE.join("\n"),
  };

  it("reports nothing when there is no Dockerfile", () => {
    expect(run(fixture({ ...base, ".nvmrc": "24.21.0\n" })).code).toBe(0);
  });

  it("passes when the Dockerfile matches .nvmrc", () => {
    const root = fixture({
      ...base,
      ".nvmrc": "24.21.0\n",
      Dockerfile: "FROM node:24.21.0-bookworm-slim\n",
    });
    expect(run(root).code).toBe(0);
  });

  it("fails when the Dockerfile differs from .nvmrc", () => {
    const root = fixture({
      ...base,
      ".nvmrc": "24.21.0\n",
      Dockerfile: "FROM node:24.20.0-bookworm-slim\n",
    });
    const result = run(root);
    expect(result.code).toBe(1);
    expect(result.stderr[0]).toContain("Dockerfile:1");
  });
});

describe("run: .dockerignore", () => {
  const base = {
    "pnpm-workspace.yaml": workspace,
    "package.json": pkg({}),
    "web/package.json": pkg({}),
    ".nvmrc": "24.21.0\n",
    Dockerfile: "FROM node:24.21.0-bookworm-slim\n",
  };

  it("fails when a Dockerfile has no .dockerignore", () => {
    const result = run(fixture(base));
    expect(result.code).toBe(1);
    expect(result.stderr).toEqual([
      ".dockerignore: missing next to the Dockerfile (the build context would hold every file)",
    ]);
  });

  it("fails when .dockerignore lets *.env files in", () => {
    const lines = REQUIRED_DOCKERIGNORE.filter((line) => line !== "**/*.env");
    const result = run(fixture({ ...base, ".dockerignore": lines.join("\n") }));
    expect(result.code).toBe(1);
    expect(result.stderr).toHaveLength(1);
    expect(result.stderr[0]).toContain('"**/*.env"');
  });

  it("passes with the repository's own .dockerignore", () => {
    const own = readFileSync(new URL("../../.dockerignore", import.meta.url), "utf8");
    expect(run(fixture({ ...base, ".dockerignore": own })).code).toBe(0);
  });
});
