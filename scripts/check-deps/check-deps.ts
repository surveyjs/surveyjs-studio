export type DependencyMap = Record<string, string>;

export interface PackageJson {
  dependencies?: DependencyMap;
  devDependencies?: DependencyMap;
  peerDependencies?: DependencyMap;
  optionalDependencies?: DependencyMap;
}

export interface Manifest {
  path: string;
  json: PackageJson;
}

export interface Violation {
  file: string;
  dependency: string;
  version: string;
  rule: "core-dependency-must-be-exact" | "surveyjs-version-mismatch";
}

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

const CORE_NAMES = new Set([
  "typescript",
  "react",
  "react-dom",
  "vite",
  "fastify",
  "openapi-typescript",
  "openapi-fetch",
  "openapi-react-query",
  "openapi-msw",
]);
const CORE_PREFIXES = ["@vitejs/", "@tanstack/", "@fastify/", "@redocly/", "survey-"];

const EXACT_SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

const isCore = (name: string): boolean =>
  CORE_NAMES.has(name) || CORE_PREFIXES.some((prefix) => name.startsWith(prefix));

const isSurveyJs = (name: string): boolean => name.startsWith("survey-");

const isAllowedVersion = (version: string): boolean =>
  version === "workspace:*" || EXACT_SEMVER.test(version);

export function checkDependencies(manifests: Manifest[]): Violation[] {
  const violations: Violation[] = [];
  const surveyEntries: Violation[] = [];

  for (const { path, json } of manifests) {
    for (const field of DEPENDENCY_FIELDS) {
      for (const [dependency, version] of Object.entries(json[field] ?? {})) {
        if (isCore(dependency) && !isAllowedVersion(version)) {
          violations.push({
            file: path,
            dependency,
            version,
            rule: "core-dependency-must-be-exact",
          });
        }
        if (isSurveyJs(dependency)) {
          surveyEntries.push({
            file: path,
            dependency,
            version,
            rule: "surveyjs-version-mismatch",
          });
        }
      }
    }
  }

  if (new Set(surveyEntries.map((entry) => entry.version)).size > 1) {
    violations.push(...surveyEntries);
  }

  return violations;
}
