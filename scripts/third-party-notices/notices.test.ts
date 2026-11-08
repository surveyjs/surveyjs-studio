import { describe, expect, it } from "vitest";
import {
  applyOverrides,
  commercialLicense,
  findProblems,
  renderNotices,
  type LicensedPackage,
} from "./notices.js";

const pkg = (over: Partial<LicensedPackage> & { name: string }): LicensedPackage => ({
  version: "1.0.0",
  license: "MIT",
  homepage: "https://example.com/" + over.name,
  licenseText: `Licence text of ${over.name}`,
  ...over,
});

describe("renderNotices", () => {
  it("sorts by name, then version", () => {
    const out = renderNotices(
      [pkg({ name: "b" }), pkg({ name: "a", version: "2.0.0" }), pkg({ name: "a" })],
      [],
    );
    const order = ["## a@1.0.0", "## a@2.0.0", "## b@1.0.0"].map((h) => out.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((x, y) => x - y));
  });

  it("gives each entry a heading, the licence id, the homepage and the text in a fenced block", () => {
    const out = renderNotices([pkg({ name: "left-pad" })], []);
    expect(out).toContain("## left-pad@1.0.0");
    expect(out).toContain("License: MIT");
    expect(out).toContain("https://example.com/left-pad");
    expect(out).toMatch(/```\nLicence text of left-pad\n```/);
  });

  it("uses a longer fence when the text holds backticks", () => {
    const out = renderNotices([pkg({ name: "x", licenseText: "a ``` b" })], []);
    expect(out).toContain("````\na ``` b\n````");
  });

  it("puts the extras last, under Other components", () => {
    const out = renderNotices(
      [pkg({ name: "zzz" })],
      [{ name: "Debian base", license: "various", text: "See /usr/share/doc." }],
    );
    expect(out.indexOf("# Other components")).toBeGreaterThan(out.indexOf("## zzz@1.0.0"));
    expect(out.indexOf("## Debian base")).toBeGreaterThan(out.indexOf("# Other components"));
    expect(out).toContain("See /usr/share/doc.");
  });

  it("points the commercial SurveyJS packages at licensing.md without their text", () => {
    const out = renderNotices(
      [pkg({ name: "survey-creator-core", license: "SEE LICENSE IN LICENSE" })],
      [],
    );
    expect(out).toContain("License: SEE LICENSE IN LICENSE");
    expect(out).toContain("customizing/licensing.md");
    expect(out).not.toContain("Licence text of survey-creator-core");
  });

  it("does not point the MIT SurveyJS packages at licensing.md", () => {
    expect(renderNotices([pkg({ name: "survey-core" })], [])).not.toContain("licensing.md");
  });
});

describe("findProblems", () => {
  it("reports a package with no licence text and one with an unknown licence", () => {
    const problems = findProblems(
      [
        pkg({ name: "a", licenseText: null }),
        pkg({ name: "b", license: "Unknown" }),
        pkg({ name: "c" }),
      ],
      {},
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("a@1.0.0");
    expect(problems[1]).toContain("b@1.0.0");
  });

  it("accepts an override with a reason", () => {
    const pkgs = [pkg({ name: "a", licenseText: null, license: "Unknown" })];
    const overrides = { a: { license: "MIT", reason: "package.json of a says MIT" } };
    expect(findProblems(pkgs, overrides)).toEqual([]);
    expect(applyOverrides(pkgs, overrides)[0]?.license).toBe("MIT");
  });

  it("refuses an override without a reason", () => {
    const pkgs = [pkg({ name: "a", licenseText: null })];
    const problems = findProblems(pkgs, { a: { license: "MIT", reason: " " } });
    expect(problems[0]).toContain("reason");
  });

  it("applies a name-keyed override to every version of the package", () => {
    const pkgs = [
      pkg({ name: "a", version: "1.0.0", licenseText: null }),
      pkg({ name: "a", version: "2.0.0", licenseText: null }),
    ];
    const overrides = { a: { license: "ISC", reason: "package.json says ISC" } };
    expect(findProblems(pkgs, overrides)).toEqual([]);
    expect(applyOverrides(pkgs, overrides).map((p) => p.license)).toEqual(["ISC", "ISC"]);
  });

  it("fails and names the package when its installed licence differs from the override", () => {
    const pkgs = [pkg({ name: "a", version: "3.0.0", licenseText: null, declared: "GPL-3.0" })];
    const problems = findProblems(pkgs, { a: { license: "MIT", reason: "checked" } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("a@3.0.0");
    expect(problems[0]).toContain("GPL-3.0");
  });

  it("accepts an override whose licence equals the installed one", () => {
    const pkgs = [pkg({ name: "a", licenseText: null, declared: "MIT" })];
    expect(findProblems(pkgs, { a: { license: "MIT", reason: "checked" } })).toEqual([]);
  });

  it("does not need text for the commercial packages, which point at licensing.md", () => {
    expect(findProblems([pkg({ name: "survey-analytics", licenseText: null })], {})).toEqual([]);
  });
});

describe("commercialLicense", () => {
  it("returns the declared licence string", () => {
    expect(commercialLicense("SEE LICENSE IN LICENSE")).toBe("SEE LICENSE IN LICENSE");
  });
  it("never yields pnpm's value for a missing field", () => {
    expect(commercialLicense(undefined)).toBe("Commercial (SEE LICENSE IN LICENSE)");
  });
  it("does not use the legacy object form or an empty string", () => {
    expect(commercialLicense({ type: "MIT" })).toBe("Commercial (SEE LICENSE IN LICENSE)");
    expect(commercialLicense("")).toBe("Commercial (SEE LICENSE IN LICENSE)");
  });
});
