// `pnpm legacy:replay` end to end against the real bridge on Studio (ADR 0041 point 3): the reads
// replay a sample built from the golden requests against a local stand-in for the old service that
// serves the bridge's own recorded answers (one altered, one that changes between its calls), and
// the smoke runs its writes twice against the bridge, which must give the same transcript.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classify } from "../../legacy-replay/src/classify.js";
import { main } from "../../legacy-replay/src/cli.js";
import { compareSmoke, runSmoke } from "../../legacy-replay/src/smoke.js";
import { loadGoldens, substitute, type Answer } from "./golden.js";
import { BASE_URL, KEYS, send } from "./harness.js";
import { OWNER_ID, ownerSurveyIds, removeSurvey } from "./studio.js";

const READS = ["getSurvey", "getActive", "getSurveyInfo", "getSurveyResults"];
const VARS = { ...KEYS, "owner.userId": OWNER_ID };

interface Row {
  path: string;
  query: string;
}

/** The golden requests that need no state of their own, as the sampled rows would be. */
function goldenRows(): Row[] {
  const rows = new Map<string, Row>();
  for (const { golden } of loadGoldens(READS)) {
    if (golden.setup !== undefined || golden.request.body !== undefined) continue;
    if (golden.request.method !== "GET") continue;
    let request;
    try {
      request = substitute(golden.request, VARS);
    } catch {
      continue; // it needs a variable of a survey of its own
    }
    const given = request.query;
    const query =
      typeof given === "string"
        ? given
        : new URLSearchParams(
            Object.entries(given ?? {}).flatMap(([name, value]) =>
              (typeof value === "string" ? [value] : value).map(
                (item) => [name, item] satisfies [string, string],
              ),
            ),
          ).toString();
    rows.set(`${request.path}?${query}`, { path: request.path, query });
  }
  return [...rows.values()].filter((row) => classify({ method: "GET", ...row }).kind === "replay");
}

const urlOf = (row: Row) => `${row.path}${row.query === "" ? "" : `?${row.query}`}`;
const csvField = (text: string) => `"${text.replaceAll('"', '""')}"`;

/** The headers the replay compares that the bridge sets. */
const COMPARED = [
  "content-type",
  "cache-control",
  "etag",
  "location",
  "access-control-allow-origin",
];

describe("legacy:replay against the bridge", () => {
  let folder: string;
  let server: Server;
  const fixture: { url: string; row: Row; answer: Answer }[] = [];
  let alteredProperty = "";

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), "legacy-replay-test-"));
    for (const row of goldenRows()) {
      const answer = await send({ method: "GET", path: row.path, query: row.query });
      const headers = Object.fromEntries(
        Object.entries(answer.headers).filter(([name]) => COMPARED.includes(name)),
      );
      fixture.push({ url: urlOf(row), row, answer: { ...answer, headers } });
    }
    const objects = fixture.filter(({ answer }) => {
      if (answer.status !== 200) return false;
      try {
        const json: unknown = JSON.parse(answer.body.toString("utf8"));
        return json !== null && typeof json === "object" && !Array.isArray(json);
      } catch {
        return false;
      }
    });
    expect(objects.length).toBeGreaterThanOrEqual(2);
    const altered = objects[0]!.url;
    alteredProperty = Object.keys(
      JSON.parse(objects[0]!.answer.body.toString("utf8")) as Record<string, unknown>,
    )[0]!;
    const changing = objects[1]!.url;

    const calls = new Map<string, number>();
    server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const url = request.url ?? "";
      const call = (calls.get(url) ?? 0) + 1;
      calls.set(url, call);
      const found = fixture.find((item) => item.url === url);
      if (found === undefined) {
        response.writeHead(404).end();
        return;
      }
      let { body } = found.answer;
      if (url === altered) {
        // A property moved: the old service names it differently.
        const json = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
        const { [alteredProperty]: value, ...rest } = json;
        body = Buffer.from(JSON.stringify({ ...rest, [`moved_${alteredProperty}`]: value }));
      } else if (url === changing && call === 2) {
        body = Buffer.from(JSON.stringify({ changed: true }));
      }
      response.writeHead(found.answer.status, found.answer.headers).end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await rm(folder, { recursive: true, force: true });
  });

  it("compares the reads: one different, one changed, the rest same; skips counted; no key in the report", async () => {
    const sample = join(folder, "sample.csv");
    const out = join(folder, "report.html");
    await writeFile(
      sample,
      [
        "time,method,path,query,status",
        ...fixture.map(
          ({ row }) => `2026-11-01T10:00:00Z,GET,${csvField(row.path)},${csvField(row.query)},200`,
        ),
        `2026-11-01T10:00:00Z,POST,${csvField("/public/v1/Survey/post/")},"",200`,
        `2026-11-01T10:00:00Z,GET,${csvField("/no/such/path")},"",200`,
      ].join("\n"),
    );
    let console_ = "";
    const code = await main(
      [
        ...["--sample", sample, "--out", out, "--bridge", BASE_URL],
        ...["--old", `http://127.0.0.1:${(server.address() as AddressInfo).port}`],
        // The pacing is not under test: the limits are far above what the sample sends.
        ...["--public-limit", "1000000", "--file-limit", "1000000", "--summary-limit", "1000000"],
      ],
      { out: (text) => (console_ += text), err: () => undefined },
      { cwd: folder },
    );

    const report = await readFile(out, "utf8");
    expect(console_).toContain("skipped: write 1, forwarded 1, unknown-method 0, unsafe-path 0");
    expect(console_).toContain("verdict: fail (1 different, 0 errors)");
    expect(code).toBe(1);
    // The altered answer, with its moved property, in the report; one changed; the rest same.
    expect(report).toContain(`moved_${alteredProperty}`);
    const count = (outcome: string) =>
      (report.match(new RegExp(`<span class="${outcome}">`, "g")) ?? []).length;
    expect(count("different")).toBe(1);
    expect(count("changed")).toBe(1);
    expect(count("error")).toBe(0);
    expect(count("rate-limited")).toBe(0);
    expect(count("same")).toBe(fixture.length - 2);
    // At least one answer is a 4xx problem body, whose trace id differs on every call.
    expect(
      fixture.some(({ answer }) => answer.status >= 400 && answer.body.includes("traceId")),
    ).toBe(true);
    for (const key of Object.values(KEYS)) {
      expect(report).not.toContain(key);
      expect(console_).not.toContain(key);
    }
  });

  it("smoke: two runs against the bridge give the same transcript", async () => {
    const before = await ownerSurveyIds();
    try {
      const first = await runSmoke(BASE_URL, KEYS.accessKey);
      const second = await runSmoke(BASE_URL, KEYS.accessKey);
      for (const run of [first, second]) {
        expect(run.stopped).toBeUndefined();
        expect(run.cleanup.outcome).toBe("not needed");
      }
      const comparison = compareSmoke(first, second);
      expect(comparison.steps.filter((step) => step.outcome !== "same")).toEqual([]);
      expect(comparison.explained).toEqual([]);
      expect(comparison.verdict).toBe("pass");
    } finally {
      for (const id of await ownerSurveyIds()) if (!before.has(id)) await removeSurvey(id);
    }
  });
});
