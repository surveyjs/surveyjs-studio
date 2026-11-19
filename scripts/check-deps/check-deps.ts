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

/**
 * Manifests whose `survey-*` packages are left out of the one-version rule: the legacy
 * compatibility suite pins the Form Library v1 on purpose, as pages built for the old service use it.
 * They must still be exact versions.
 */
const SURVEYJS_VERSION_EXEMPT = new Set(["legacy-compat-tests/package.json"]);

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
        if (isSurveyJs(dependency) && !SURVEYJS_VERSION_EXEMPT.has(path)) {
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
