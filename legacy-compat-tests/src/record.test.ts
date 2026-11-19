// The recording script (scripts/record.ts), run against the suite's own bridge with the fixtures'
// IDs standing in for a test account's: every recording must match its derived golden file, the
// script must never print a body, and it must refuse to write inside the repository.
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { insideRepository, record, UsageError } from "../scripts/record.js";
import { loadGoldens, type Golden } from "./golden.js";
import { BASE_URL, PROVIDER } from "./harness.js";
import { createSurvey, removeSurvey, type FreshSurvey } from "./studio.js";

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The fixtures' IDs and file names the golden requests use, each standing for itself. */
const IDS = Object.fromEntries(
  [
    "22222222-0000-4000-8000-a00000000001",
    "22222222-0000-4000-8000-a00000000002",
    "22222222-0000-4000-8000-a00000000005",
    "22222222-0000-4000-8000-a00000000006",
    "44444444-0000-4000-8000-a00000000001",
    "44444444-0000-4000-8000-a00000000002",
    "44444444-0000-4000-8000-a00000000008",
    "99999999-0000-4000-8000-a00000000001",
    "99999999-0000-4000-8000-a00000000002.png",
  ].map((id) => [id, id]),
);

function temporaryFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), "legacy-compat-recordings-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function fresh(settings?: Record<string, unknown>): Promise<FreshSurvey> {
  const survey = await createSurvey(settings);
  onTestFinished(() => removeSurvey(survey.surveyId));
  return survey;
}

describe("the recording script", () => {
  it.each([
    ["the repository", join(PACKAGE, "..")],
    ["the package", PACKAGE],
    ["a new folder in the package", join(PACKAGE, "recordings", "new")],
    ["a relative path", relative(process.cwd(), join(PACKAGE, "recordings"))],
    ["a path in other letter case (Windows)", PACKAGE.toUpperCase()],
  ])("refuses an --out inside %s", async (what, out) => {
    if (what.endsWith("(Windows)") && process.platform !== "win32") return;
    expect(insideRepository(out)).toBe(true);
    await expect(
      record({ base: BASE_URL, surveys: { ids: IDS }, out, log: () => undefined }),
    ).rejects.toThrow(UsageError);
  });

  it("refuses an --out reached through a link into the repository", async () => {
    const link = join(temporaryFolder(), "link");
    // A junction needs no privileges on Windows; elsewhere it is a plain directory link.
    symlinkSync(PACKAGE, link, "junction");
    try {
      const out = join(link, "recordings");
      expect(insideRepository(out)).toBe(true);
      await expect(
        record({ base: BASE_URL, surveys: { ids: IDS }, out, log: () => undefined }),
      ).rejects.toThrow(UsageError);
    } finally {
      // The link itself, never what it points to.
      unlinkSync(link);
    }
  });

  it("writes recorded files that match every derived golden, and prints no body", async () => {
    const out = temporaryFolder();
    expect(insideRepository(out)).toBe(false);
    const survey = await fresh();
    const publicSurvey = await fresh({ publicResults: true, storeRespondentIp: true });
    const lines: string[] = [];
    const problems = await record({
      base: BASE_URL,
      surveys: {
        ids: IDS,
        survey,
        cases: { "getSurveyPublicResults/no-client-id-or-ip": publicSurvey },
      },
      out,
      log: (line) => lines.push(line),
    });

    const goldens = loadGoldens();
    expect(lines).toHaveLength(goldens.length);
    // Cases limited to other providers (the legacy file shares) differ here, as Studio does.
    const elsewhere = goldens
      .filter(
        ({ golden }) => golden.providers !== undefined && !golden.providers.includes(PROVIDER),
      )
      .map(({ name }) => name);
    const differing = lines.filter((line) => !line.endsWith("matches the derived golden"));
    expect(differing.map((line) => line.slice(0, line.indexOf(":")))).toEqual(elsewhere);
    expect(problems).toBe(elsewhere.length);
    for (const line of lines) {
      expect(line).not.toMatch(/Customer feedback|Check parameter|iVBOR|satisfaction":/);
    }

    for (const { name, golden } of goldens) {
      const recorded = JSON.parse(readFileSync(join(out, `${name}.json`), "utf8")) as Golden;
      expect(recorded.source).toBe("recorded");
      expect(recorded.request).toEqual(golden.request);
    }
    expect(readdirSync(out).sort()).toEqual(readdirSync(join(PACKAGE, "golden")).sort());
    // The survey's own IDs are written back as the golden's variables.
    const completed = JSON.parse(readFileSync(join(out, "upload", "image.json"), "utf8")) as Golden;
    expect(JSON.stringify(completed)).not.toContain(survey.postId);
  });
});
