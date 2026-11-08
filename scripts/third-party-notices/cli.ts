// `node --import tsx scripts/third-party-notices/cli.ts --out <file>`: writes the third-party notice of the
// production dependencies of the server and the web app, plus the fonts, Node.js and the Debian base.
// Exit 1 and a list when a package has no licence text or an unknown licence (overrides.ts).
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyOverrides,
  COMMERCIAL_PACKAGES,
  commercialLicense,
  findProblems,
  renderNotices,
  type Extra,
  type LicensedPackage,
} from "./notices.js";
import { OVERRIDES } from "./overrides.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKSPACES = ["@surveyjs-studio/server", "@surveyjs-studio/web"];
const FONT_DIRS = [
  ["Open Sans", "web/src/shell/surveyjs-site/assets/site/Content/Fonts/Google/OFL-OpenSans.txt"],
  ["Raleway", "web/src/shell/surveyjs-site/assets/site/Content/Fonts/Google/OFL-Raleway.txt"],
  ["DM Mono", "web/src/shell/surveyjs-site/assets/site/Content/Fonts/V2/OFL-DMMono.txt"],
  ["Lato", "web/src/shell/surveyjs-site/assets/site/Content/Fonts/V2/OFL-Lato.txt"],
] as const;

interface ListEntry {
  name: string;
  versions: string[];
  paths: string[];
  license: string;
  homepage?: string;
}

function readLicenseText(folder: string): string | null {
  const files = readdirSync(folder)
    .filter((file) => /^(licen[sc]e|copying)/i.test(file) && statSync(join(folder, file)).isFile())
    .sort();
  if (files.length === 0) return null;
  return files.map((file) => readFileSync(join(folder, file), "utf8").trim()).join("\n\n---\n\n");
}

function readLicenseField(folder: string): unknown {
  return (JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as { license?: unknown })
    .license;
}

function listPackages(): LicensedPackage[] {
  const byKey = new Map<string, LicensedPackage>();
  for (const workspace of WORKSPACES) {
    const out = execSync(`pnpm licenses list --prod --json --filter ${workspace}`, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    const entries = Object.values(JSON.parse(out) as Record<string, ListEntry[]>).flat();
    for (const entry of entries) {
      entry.versions.forEach((version, index) => {
        const id = `${entry.name}@${version}`;
        if (byKey.has(id)) return;
        const folder = entry.paths[index] ?? entry.paths[0];
        if (folder === undefined) throw new Error(`${id}: pnpm lists no path`);
        const declared = readLicenseField(folder);
        byKey.set(id, {
          name: entry.name,
          version,
          license: COMMERCIAL_PACKAGES.includes(entry.name)
            ? commercialLicense(declared)
            : entry.license,
          declared: typeof declared === "string" ? declared : null,
          homepage: entry.homepage ?? null,
          licenseText: readLicenseText(folder),
        });
      });
    }
  }
  return [...byKey.values()];
}

/** Node's own LICENSE sits in the node image under share/doc or include; else a pointer to it. */
function nodeExtra(): Extra {
  const prefix = resolve(dirname(process.execPath), "..");
  const candidates = [join(prefix, "share/doc/node/LICENSE"), join(prefix, "include/node/LICENSE")];
  const found = candidates.find((file) => existsSync(file));
  return {
    name: `Node.js ${process.version}`,
    license: "MIT",
    text: found
      ? readFileSync(found, "utf8")
      : `The Node.js runtime of the image is under the MIT licence: https://github.com/nodejs/node/blob/${process.version}/LICENSE`,
  };
}

function extras(): Extra[] {
  return [
    ...FONT_DIRS.map(([name, file]) => ({
      name: `${name} (font)`,
      license: "SIL Open Font License 1.1",
      text: readFileSync(join(root, file), "utf8"),
    })),
    nodeExtra(),
    {
      name: "Debian base image",
      license: "various",
      text: "The licences of the operating system packages are in /usr/share/doc/*/copyright in this image.",
    },
  ];
}

const outIndex = process.argv.indexOf("--out");
const out = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
if (!out) {
  console.error("Usage: node --import tsx scripts/third-party-notices/cli.ts --out <file>");
  process.exit(2);
}

const pkgs = listPackages();
const problems = findProblems(pkgs, OVERRIDES);
if (problems.length > 0) {
  console.error(
    `The notice cannot be written (add a justified entry to overrides.ts or fix the package):`,
  );
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
writeFileSync(out, renderNotices(applyOverrides(pkgs, OVERRIDES), extras()));
console.log(`Wrote ${out}: ${pkgs.length} packages and the other components.`);
