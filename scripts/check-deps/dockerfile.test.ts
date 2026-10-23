import { describe, expect, it } from "vitest";
import {
  dockerfileNodeProblems,
  dockerignoreProblems,
  REQUIRED_DOCKERIGNORE,
} from "./dockerfile.js";

describe("dockerfileNodeProblems", () => {
  it("accepts an exact tag equal to .nvmrc", () => {
    const dockerfile = "FROM node:24.21.0-bookworm-slim AS build\nRUN true\n";
    expect(dockerfileNodeProblems(dockerfile, "24.21.0\n")).toEqual([]);
  });

  it("accepts a v-prefixed .nvmrc and checks every FROM node line", () => {
    const dockerfile =
      "FROM node:24.21.0-bookworm-slim AS build\nFROM node:24.21.0-bookworm-slim AS runtime\n";
    expect(dockerfileNodeProblems(dockerfile, "v24.21.0")).toEqual([]);
  });

  it("names the line of a different version", () => {
    const dockerfile =
      "FROM node:24.21.0-bookworm-slim AS build\nFROM node:24.20.0-bookworm-slim\n";
    const problems = dockerfileNodeProblems(dockerfile, "24.21.0");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("Dockerfile:2");
    expect(problems[0]).toContain("24.20.0");
  });

  it("rejects a tag that is not an exact version", () => {
    const problems = dockerfileNodeProblems("FROM node:24-bookworm-slim\n", "24.21.0");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("Dockerfile:1");
  });

  it("reports a Dockerfile without a FROM node line", () => {
    expect(dockerfileNodeProblems("FROM alpine\n", "24.21.0")).toHaveLength(1);
  });
});

describe("dockerignoreProblems", () => {
  const all = REQUIRED_DOCKERIGNORE.join("\n");

  it("accepts every required pattern, comments, blank lines and a non-secret negation", () => {
    const text = `# secrets\n\n${all}\n!**/.env.example\n!e2e/package.json\n`;
    expect(dockerignoreProblems(text)).toEqual([]);
  });

  it("names each missing pattern", () => {
    const problems = dockerignoreProblems("**/.env\n**/.env.*\n");
    expect(problems).toHaveLength(REQUIRED_DOCKERIGNORE.length - 2);
    expect(problems.join("\n")).toContain('"**/*.env"');
  });

  it("rejects a negation that re-includes a settings or key file", () => {
    const problems = dockerignoreProblems(`${all}\n!server/prod.env\n!certs/site.pem\n`);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("!server/prod.env");
  });
});
