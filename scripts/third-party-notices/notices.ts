// The third-party notice of the image (THIRD_PARTY_NOTICES.md): pure rendering and checking.
// cli.ts reads the installed packages; the Dockerfile's build stage runs it.

export interface LicensedPackage {
  name: string;
  version: string;
  license: string;
  homepage: string | null;
  licenseText: string | null;
  /** The `license` string of the installed package.json, when it was read (checked against an override). */
  declared?: string | null;
}

export interface Extra {
  name: string;
  license: string;
  text: string;
}

export interface Override {
  license: string;
  reason: string;
}

/**
 * Package name (every version) to the licence that package really has. The generator checks it
 * against the installed package.json, so a bump that changes the licence fails the build.
 */
export type Overrides = Readonly<Record<string, Override>>;

/** Survey Creator and the Dashboard are commercial: their entry points at licensing.md instead. */
export const COMMERCIAL_PACKAGES: readonly string[] = [
  "survey-creator-core",
  "survey-creator-react",
  "survey-analytics",
];

const LICENSING_DOC =
  "https://github.com/surveyjs/surveyjs-studio/blob/master/docs/customizing/licensing.md";

/** The licence of a commercial package: its own `license` string; never pnpm's value, which is MIT. */
export function commercialLicense(declared: unknown): string {
  return typeof declared === "string" && declared.trim() !== ""
    ? declared
    : "Commercial (SEE LICENSE IN LICENSE)";
}

const key = (pkg: LicensedPackage): string => `${pkg.name}@${pkg.version}`;
const isCommercial = (pkg: LicensedPackage): boolean => COMMERCIAL_PACKAGES.includes(pkg.name);

export function applyOverrides(pkgs: LicensedPackage[], overrides: Overrides): LicensedPackage[] {
  return pkgs.map((pkg) => {
    const override = overrides[pkg.name];
    return override ? { ...pkg, license: override.license } : pkg;
  });
}

/** What would make the notice wrong: no licence text, an unknown licence, an override with no reason. */
export function findProblems(pkgs: LicensedPackage[], overrides: Overrides): string[] {
  const problems: string[] = [];
  for (const pkg of pkgs) {
    const override = overrides[pkg.name];
    if (override) {
      if (override.reason.trim() === "") {
        problems.push(`${key(pkg)}: its override has no reason`);
      }
      if (pkg.declared != null && pkg.declared !== override.license) {
        problems.push(
          `${key(pkg)}: its package.json declares ${pkg.declared}, the override says ${override.license}`,
        );
      }
      continue;
    }
    if (pkg.license.trim() === "" || /^unknown$/i.test(pkg.license.trim())) {
      problems.push(`${key(pkg)}: unknown licence`);
    } else if (!isCommercial(pkg) && (pkg.licenseText === null || pkg.licenseText.trim() === "")) {
      problems.push(`${key(pkg)}: no licence file in the package`);
    }
  }
  return problems;
}

function fenced(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${text.trim()}\n${fence}`;
}

const byNameThenVersion = (a: LicensedPackage, b: LicensedPackage): number =>
  a.name < b.name
    ? -1
    : a.name > b.name
      ? 1
      : a.version < b.version
        ? -1
        : a.version > b.version
          ? 1
          : 0;

export function renderNotices(pkgs: LicensedPackage[], extras: Extra[]): string {
  const parts = [
    "# Third-party notices",
    "SurveyJS Studio includes the components below. Each entry gives the licence the package declares and the licence text it ships.",
  ];
  for (const pkg of [...pkgs].sort(byNameThenVersion)) {
    const lines = [`## ${key(pkg)}`, `License: ${pkg.license}`];
    if (pkg.homepage) lines.push(`Homepage: ${pkg.homepage}`);
    if (isCommercial(pkg)) {
      lines.push(
        `This package is commercial. The licence of the SurveyJS packages is explained in docs/customizing/licensing.md: ${LICENSING_DOC}`,
      );
    } else if (pkg.licenseText) {
      lines.push(fenced(pkg.licenseText));
    } else {
      lines.push("The package ships no licence file; the licence is the one named above.");
    }
    parts.push(lines.join("\n\n"));
  }
  parts.push("# Other components");
  for (const extra of extras) {
    parts.push([`## ${extra.name}`, `License: ${extra.license}`, fenced(extra.text)].join("\n\n"));
  }
  return parts.join("\n\n") + "\n";
}
