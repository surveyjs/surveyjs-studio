// The recording script (scripts/record.ts), run against the suite's own bridge with the fixtures'
// IDs standing in for a test account's: every recording must match its derived golden file, the
// script must never print a body, and it must refuse to write inside the repository.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { insideRepository, realPath, record, UsageError } from "../scripts/record.js";
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
    ["a child named with two dots", join(PACKAGE, "..", "..recordings")],
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

  it("writes where it checked: `..` is taken before links are followed", async () => {
    const dir = temporaryFolder();
    const link = join(dir, "link");
    symlinkSync(PACKAGE, link, "junction");
    try {
      // Through the link, `link/../outside` would be next to the package, in the repository;
      // the script resolves it to `<dir>/outside`, checks that, and writes there.
      const out = `${link}${sep}..${sep}outside`;
      expect(realPath(out)).toBe(join(realPath(dir), "outside"));
      expect(insideRepository(out)).toBe(false);
      await record({
        base: BASE_URL,
        surveys: { ids: IDS },
        out,
        only: "getSurvey/found",
        log: () => undefined,
      });
      expect(existsSync(join(dir, "outside", "getSurvey", "found.json"))).toBe(true);
      expect(existsSync(join(PACKAGE, "..", "outside"))).toBe(false);
    } finally {
      unlinkSync(link);
    }
  });

  it("prints no body when an answer is not what the script expects", async () => {
    // A stand-in "old API" that answers every request with 200 and a text body.
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("SECRET-ANSWER-TEXT {not json");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    onTestFinished(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    );
    const { port } = server.address() as AddressInfo;
    const printed: string[] = [];
    const capture = (...args: unknown[]) => void printed.push(args.map(String).join(" "));
    const log = vi.spyOn(console, "log").mockImplementation(capture);
    const error = vi.spyOn(console, "error").mockImplementation(capture);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      printed.push(String(chunk));
      return true;
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      printed.push(String(chunk));
      return true;
    });
    try {
      await record({
        base: `http://127.0.0.1:${port}`,
        surveys: {
          ids: IDS,
          survey: {
            surveyId: "11111111-1111-4111-8111-111111111111",
            postId: "11111111-1111-4111-8111-111111111112",
            resultId: "11111111-1111-4111-8111-111111111113",
          },
        },
        out: temporaryFolder(),
        only: "image",
      });
    } finally {
      log.mockRestore();
      error.mockRestore();
      stdout.mockRestore();
      stderr.mockRestore();
    }
    expect(printed.join(" | ")).not.toContain("SECRET");
    expect(printed).toContainEqual(
      "image/uploaded: failed (the setup upload's answer is not a JSON string)",
    );
  });

  it("writes recorded files that match every derived golden, and prints no body", async () => {
    const out = temporaryFolder();
    expect(insideRepository(out)).toBe(false);
    const goldens = loadGoldens();
    // Each case with a setup gets a survey of its own, so no case depends on another's posts.
    const cases: Record<string, FreshSurvey> = {};
    for (const { name, golden } of goldens) {
      if (golden.setup !== undefined) cases[name] = await fresh(golden.setup.survey.settings);
    }
    const lines: string[] = [];
    const problems = await record({
      base: BASE_URL,
      surveys: { ids: IDS, cases },
      out,
      log: (line) => lines.push(line),
    });

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
    const uploaded = JSON.parse(readFileSync(join(out, "upload", "image.json"), "utf8")) as Golden;
    expect(JSON.stringify(uploaded)).not.toContain(cases["upload/image"]?.postId);
  });
});
