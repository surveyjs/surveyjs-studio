import { describe, expect, it } from "vitest";
import { checkDependencies, type Manifest } from "./check-deps.js";

const manifest = (json: Manifest["json"], path = "package.json"): Manifest => ({ path, json });

describe("checkDependencies", () => {
  it("accepts exact versions of core dependencies", () => {
    const result = checkDependencies([
      manifest({
        dependencies: { react: "19.2.0", fastify: "5.1.0-rc.1" },
        devDependencies: { typescript: "6.0.3" },
      }),
    ]);
    expect(result).toEqual([]);
  });

  it.each(["^1.2.3", "~1.2.3", ">=1.2.3", "*", "latest", "x", "1.x", "1.2.3 - 2.0.0"])(
    "rejects range %s on a core dependency",
    (version) => {
      const result = checkDependencies([manifest({ devDependencies: { typescript: version } })]);
      expect(result).toEqual([
        {
          file: "package.json",
          dependency: "typescript",
          version,
          rule: "core-dependency-must-be-exact",
        },
      ]);
    },
  );

  it.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const)(
    "checks %s",
    (field) => {
      const result = checkDependencies([manifest({ [field]: { react: "^19.0.0" } })]);
      expect(result).toHaveLength(1);
    },
  );

  it("allows ranges on non-core dependencies", () => {
    expect(checkDependencies([manifest({ dependencies: { zod: "^4.0.0" } })])).toEqual([]);
  });

  it("allows workspace:* on core dependencies", () => {
    expect(checkDependencies([manifest({ dependencies: { fastify: "workspace:*" } })])).toEqual([]);
  });

  it("matches scoped and prefix patterns as core", () => {
    const result = checkDependencies([
      manifest({
        dependencies: {
          "@tanstack/react-query": "^5.0.0",
          "@fastify/cors": "~10.0.0",
          "@vitejs/plugin-react": "^5.0.0",
          "@redocly/cli": "^2.0.0",
          "survey-core": "^2.0.0",
          "openapi-fetch": "^0.14.0",
        },
      }),
    ]);
    expect(result.map((v) => v.dependency).sort()).toEqual([
      "@fastify/cors",
      "@redocly/cli",
      "@tanstack/react-query",
      "@vitejs/plugin-react",
      "openapi-fetch",
      "survey-core",
    ]);
  });

  it("does not treat lookalike names as core", () => {
    const result = checkDependencies([
      manifest({ dependencies: { "my-survey-core": "^1.0.0", "@tanstack-fake/x": "^1.0.0" } }),
    ]);
    expect(result).toEqual([]);
  });

  it("flags survey-* packages at different versions across manifests", () => {
    const result = checkDependencies([
      manifest({ dependencies: { "survey-core": "2.0.1" } }, "web/package.json"),
      manifest({ dependencies: { "survey-react-ui": "2.0.2" } }, "server/package.json"),
    ]);
    expect(result.filter((v) => v.rule === "surveyjs-version-mismatch")).toEqual([
      {
        file: "web/package.json",
        dependency: "survey-core",
        version: "2.0.1",
        rule: "surveyjs-version-mismatch",
      },
      {
        file: "server/package.json",
        dependency: "survey-react-ui",
        version: "2.0.2",
        rule: "surveyjs-version-mismatch",
      },
    ]);
  });

  it("accepts survey-* packages at the same version", () => {
    const result = checkDependencies([
      manifest({ dependencies: { "survey-core": "2.0.1", "survey-react-ui": "2.0.1" } }),
    ]);
    expect(result).toEqual([]);
  });

  it("accepts a prerelease for survey-* packages", () => {
    const result = checkDependencies([
      manifest({
        dependencies: { "survey-core": "2.0.1-beta.3", "survey-react-ui": "2.0.1-beta.3" },
      }),
    ]);
    expect(result).toEqual([]);
  });

  it("fails overall for ranged survey-* packages", () => {
    const result = checkDependencies([
      manifest({ dependencies: { "survey-core": "^2.0.0", "survey-react-ui": "^2.0.0" } }),
    ]);
    expect(result.map((v) => [v.dependency, v.rule])).toEqual([
      ["survey-core", "core-dependency-must-be-exact"],
      ["survey-react-ui", "core-dependency-must-be-exact"],
    ]);
  });

  it.each([
    "v1.2.3",
    "1.2",
    "npm:react@18.0.0",
    "file:../x",
    "link:../x",
    "git+https://github.com/a/b.git",
    "github:a/b",
    "workspace:^",
    "workspace:~",
  ])("rejects bypass version %s on a core dependency", (version) => {
    const result = checkDependencies([manifest({ dependencies: { react: version } })]);
    expect(result.map((v) => v.rule)).toEqual(["core-dependency-must-be-exact"]);
  });
});
