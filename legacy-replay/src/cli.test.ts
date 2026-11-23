import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keyHashPrefix } from "../../bridge/src/callers.js";
import { main, REPOSITORY_ROOT } from "./cli.js";

const KEY = "Secret0Key0Value";
const SURVEY = "5af48e08-a0a5-44a5-83f4-1c90e8e98de1";
const OLD = "https://old.example";
const BRIDGE = "https://bridge.example";
const HERE = dirname(fileURLToPath(import.meta.url));

const SAMPLE = [
  "time,method,path,query,status",
  `2026-11-20T10:00:00Z,GET,/private/Surveys/getSurveyResults/${SURVEY},accessKey=${KEY},200`,
  `2026-11-21T10:00:00Z,GET,/public/Survey/getSurvey,surveyId=${SURVEY},200`,
  "2026-11-21T10:00:01Z,POST,/public/Survey/post,,200",
  "2026-11-21T10:00:02Z,GET,/elsewhere/page,,200",
  "2026-11-21T10:00:03Z,BREW,/public/Survey/getSurvey,,200",
  `2026-11-21T10:00:04Z,GET,/private/Surveys/getSurveyResults/..%2FgenerateAccessKey,accessKey=${KEY},200`,
].join("\n");

let dir: string;
let samplePath: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "legacy-replay-cli-"));
  samplePath = join(dir, "sample.csv");
  await writeFile(samplePath, SAMPLE);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Runs the command with a fetch that answers `bridgeBody` from the bridge, `{}` from the old service. */
async function run(
  args: string[],
  options: { cwd?: string; bridgeBody?: string; bridgeFails?: boolean } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const requests: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (options.bridgeFails && url.startsWith(BRIDGE)) throw new Error("connection refused");
    const body = url.startsWith(BRIDGE) ? (options.bridgeBody ?? "{}") : "{}";
    return new Response(body, { headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  const code = await main(
    args,
    { out: (text) => out.push(text), err: (text) => err.push(text) },
    { cwd: options.cwd ?? dir, fetch, sleep: async () => {} },
  );
  return { code, out: out.join(""), err: err.join(""), requests };
}

const required = (out: string) => [
  "--",
  "--sample",
  samplePath,
  "--old",
  OLD,
  "--bridge",
  BRIDGE,
  "--out",
  out,
];

describe("legacy:replay", () => {
  it("finds the repository it belongs to", () => {
    expect(REPOSITORY_ROOT).toBe(resolve(HERE, "..", ".."));
    expect(existsSync(join(REPOSITORY_ROOT, "pnpm-workspace.yaml"))).toBe(true);
  });

  it("replays the reads, writes the report and prints counts and the verdict only", async () => {
    const out = join(dir, "same.html");
    const result = await run(required(out));
    expect(result.code).toBe(0);
    expect(result.requests).toHaveLength(6);
    expect(result.out).toMatch(/getSurveyResults/);
    expect(result.out).toMatch(/write 1, forwarded 1, unknown-method 1, unsafe-path 1/);
    expect(result.out).toMatch(/verdict: pass/);
    const console = result.out + result.err;
    expect(console).not.toMatch(new RegExp(KEY, "i"));
    expect(console).not.toContain(SURVEY);
    expect(console).not.toContain(keyHashPrefix(KEY));
    const report = await readFile(out, "utf8");
    expect(report).toContain(`accessKey=${keyHashPrefix(KEY)}…`);
    expect(report).not.toMatch(new RegExp(KEY, "i"));
  });

  it("exits 1 when the bridge answers differently", async () => {
    const result = await run(required(join(dir, "different.html")), { bridgeBody: '{"a":1}' });
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/verdict: fail \(2 different, 0 errors\)/);
    expect(result.out + result.err).not.toMatch(new RegExp(KEY, "i"));
    expect(result.out + result.err).not.toContain(SURVEY);
  });

  it("exits 1 when a request fails", async () => {
    const result = await run(required(join(dir, "error.html")), { bridgeFails: true });
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/verdict: fail \(0 different, 2 errors\)/);
  });

  it("selects by action, time and number", async () => {
    const out = join(dir, "selected.html");
    expect((await run([...required(out), "--actions", "getSurvey"])).requests).toHaveLength(3);
    expect(
      (await run([...required(out), "--since", "2026-11-21T00:00:00Z"])).requests,
    ).toHaveLength(3);
    expect((await run([...required(out), "--limit", "1"])).requests).toHaveLength(3);
  });

  it("refuses an action that is not a replayed read (exit 2)", async () => {
    const result = await run([...required(join(dir, "x.html")), "--actions", "getSurvey,post"]);
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/post/);
    expect(result.requests).toEqual([]);
  });

  it.each([
    ["no --sample", ["--old", OLD, "--bridge", BRIDGE, "--out", "x.html"]],
    ["a bad URL", ["--sample", "s.csv", "--old", "old", "--bridge", BRIDGE, "--out", "x.html"]],
    [
      "an old URL with a path",
      ["--sample", "s.csv", "--old", `${OLD}/api`, "--bridge", BRIDGE, "--out", "x.html"],
    ],
    [
      "a bridge URL with a query",
      ["--sample", "s.csv", "--old", OLD, "--bridge", `${BRIDGE}/?a=1`, "--out", "x.html"],
    ],
    [
      "a bridge URL with a fragment",
      ["--sample", "s.csv", "--old", OLD, "--bridge", `${BRIDGE}#x`, "--out", "x.html"],
    ],
    [
      "a bad limit",
      ["--sample", "s.csv", "--old", OLD, "--bridge", BRIDGE, "--out", "x.html", "--limit", "0"],
    ],
    [
      "a bad rate",
      [
        "--sample",
        "s.csv",
        "--old",
        OLD,
        "--bridge",
        BRIDGE,
        "--out",
        "x.html",
        "--summary-limit",
        "-1",
      ],
    ],
    [
      "a bad time",
      [
        "--sample",
        "s.csv",
        "--old",
        OLD,
        "--bridge",
        BRIDGE,
        "--out",
        "x.html",
        "--since",
        "yesterday",
      ],
    ],
    [
      "an unknown option",
      ["--sample", "s.csv", "--old", OLD, "--bridge", BRIDGE, "--out", "x.html", "--yes"],
    ],
  ])("is a usage error with %s (exit 2)", async (_name, args) => {
    // A readable sample and a writable report: only the option at fault can stop the run.
    const result = await run(
      args.map((arg) =>
        arg === "s.csv" ? samplePath : arg === "x.html" ? join(dir, "usage.html") : arg,
      ),
    );
    expect(result.code).toBe(2);
    expect(result.err.split("\n")[0]).not.toMatch(/cannot be|folder|inside the repository/);
    expect(result.err).toMatch(/Usage: pnpm legacy:replay/);
    expect(result.requests).toEqual([]);
  });

  it("is a usage error when the sample lacks a column", async () => {
    const sample = join(dir, "bad.csv");
    await writeFile(sample, "time,method,path,status\n");
    const args = required(join(dir, "x.html"));
    args[2] = sample;
    const result = await run(args);
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/"query"/);
  });

  describe("refuses a report inside the repository before any request (exit 2)", () => {
    const repo = REPOSITORY_ROOT;
    const toRepoFromOutside = relative(tmpdir(), repo);
    const cases: [string, string, string][] = [
      ["./x.html from the repository root", "./x.html", repo],
      ["./reports/x.html, a folder not made yet", "./reports/x.html", repo],
      ["src/x.html from a package folder", "src/x.html", join(repo, "legacy-replay")],
      ["<outside>/../<repo>/x.html", `${tmpdir()}${sep}${toRepoFromOutside}${sep}x.html`, tmpdir()],
      [
        "the repository root in another letter case",
        `${repo.charAt(0).toLowerCase()}${repo.slice(1)}/x.html`,
        tmpdir(),
      ],
      ...(process.platform === "win32"
        ? [
            [
              "a Windows path in upper case",
              `${repo.toUpperCase()}\\LEGACY-REPLAY\\x.html`,
              tmpdir(),
            ] as [string, string, string],
          ]
        : []),
    ];
    it.each(cases)("%s", async (_name, out, cwd) => {
      const result = await run(required(out), { cwd });
      expect(result.code).toBe(2);
      expect(result.err).toMatch(/inside the repository/);
      expect(result.requests).toEqual([]);
      expect(existsSync(resolve(cwd, out))).toBe(false);
    });

    it("and a folder that does not exist", async () => {
      const result = await run(required(join(dir, "missing", "x.html")));
      expect(result.code).toBe(2);
      expect(result.err).toMatch(/--out/);
      expect(result.requests).toEqual([]);
    });
  });
});
