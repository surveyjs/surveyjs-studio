import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { main } from "./cli.js";
import type { Answer } from "./compare.js";
import { compareSmoke, normalize, runSmoke, SMOKE_STEPS, type SmokeTranscript } from "./smoke.js";

const KEY = "Smoke0Key0Value0";
const OLD = "https://old.example";
const BRIDGE = "https://bridge.example";

interface Call {
  method: string;
  url: URL;
  redirect: RequestInit["redirect"];
  body: RequestInit["body"];
}

interface ServiceOptions {
  /** An answer (or a failed request) by action, instead of the service's own. */
  override?: (action: string, url: URL) => Response | Error | undefined;
  /** The old service's quirks: all-zero `CreatorId`, `IsPublished` null, the newest response first. */
  old?: boolean;
}

/** The action of a legacy API path: `/private/v1/Surveys/publish/{id}` → `publish`. */
const actionOf = (url: URL) => {
  const segments = url.pathname.split("/").filter(Boolean);
  return segments[segments[1] === "v1" ? 3 : 2] ?? "";
};

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
const empty = (status = 200) => new Response(null, { status });

/** A small stand-in for the legacy API's write actions: surveys, responses and uploads in memory. */
function fakeService(options: ServiceOptions = {}) {
  const calls: Call[] = [];
  const surveys = new Map<string, { postId: string; name: string }>();
  const rows: Record<string, unknown>[] = [];
  /** A record's date: without `Z` (golden create/named.json); the old one with 7 decimals. */
  const date = () => {
    const iso = new Date(Date.now() - Math.floor(Math.random() * 1e6)).toISOString();
    return options.old ? iso.replace("Z", "1234") : iso.replace("Z", "");
  };
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ method, url, redirect: init?.redirect, body: init?.body });
    const segments = url.pathname.split("/").filter(Boolean);
    const action = actionOf(url);
    const overridden = options.override?.(action, url);
    if (overridden instanceof Error) throw overridden;
    if (overridden) return overridden;
    const routeId = segments[segments[1] === "v1" ? 4 : 3];
    if (url.searchParams.get("accessKey") !== KEY && segments[0] === "private") {
      return new Response(`The accessKey '${url.searchParams.get("accessKey")}' is incorrect.`, {
        status: 400,
      });
    }
    switch (action) {
      case "create": {
        const id = randomUUID();
        const postId = randomUUID();
        const name = url.searchParams.get("name") ?? "";
        surveys.set(id, { postId, name });
        return json({
          Name: name,
          IsArchived: false,
          UserId: randomUUID(),
          CreatorId: options.old ? "00000000-0000-0000-0000-000000000000" : randomUUID(),
          PostId: postId,
          ResultId: randomUUID(),
          PublishId: null,
          IsPublished: options.old ? null : true,
          UseCookies: false,
          UpdatedOn: date(),
          CreatedAt: date(),
          AllowAccessResult: false,
          StoreIPAddress: false,
          Theme: null,
          Json: null,
          Id: id,
        });
      }
      case "changeJson":
      case "changeName":
      case "publish":
      case "archive":
      case "restore":
      case "deleteAllResults":
        return empty();
      case "post": {
        const body = JSON.parse(String(init?.body)) as Record<string, string>;
        const row = JSON.parse(body.surveyResult!) as Record<string, unknown>;
        row.HappendAt = `${new Date().toISOString().slice(0, 19)}Z`;
        if (body.clientId) row.ClientId = body.clientId;
        row.InstanceId = randomUUID();
        if (options.old) rows.unshift(row);
        else rows.push(row);
        return empty();
      }
      case "upload":
        return json(`dxsfile:${options.old ? randomUUID() : "ab".repeat(32)}.pdf`);
      case "getSurveyResults":
        return json({ Data: rows, ResultCount: rows.length });
      case "deleteResult":
        return rows.some((row) => row.InstanceId === url.searchParams.get("instanceId"))
          ? empty()
          : empty(400);
      case "delete":
        return surveys.delete(routeId ?? "") ? empty() : empty(400);
      default:
        return empty(404);
    }
  };
  return { calls, surveys, rows, fetch: fetch as typeof globalThis.fetch };
}

describe("runSmoke", () => {
  it("runs the write actions in order on a survey it creates, following no redirect", async () => {
    const service = fakeService();
    const transcript = await runSmoke(OLD, KEY, { fetch: service.fetch });

    expect(transcript.steps.map((step) => step.step)).toEqual(SMOKE_STEPS);
    expect(transcript.steps.every((step) => step.answer && step.answer.status === 200)).toBe(true);
    expect(service.calls.map((call) => `${call.method} ${actionOf(call.url)}`)).toEqual([
      "POST create",
      "PUT changeJson",
      "PUT changeName",
      "PUT publish",
      "POST post",
      "POST post",
      "POST upload",
      "GET getSurveyResults",
      "DELETE deleteResult",
      "DELETE deleteAllResults",
      "PUT archive",
      "PUT restore",
      "DELETE delete",
    ]);
    expect(service.calls.every((call) => call.redirect === "manual")).toBe(true);
    expect(service.calls.every((call) => call.url.origin === OLD)).toBe(true);
    expect(transcript.name).toMatch(/^legacy-replay smoke \d{4}-\d\d-\d\dT/);
    expect(service.calls[0]!.url.searchParams.get("name")).toBe(transcript.name);
    // The survey is gone: the sequence's own delete removed it, so no cleanup was sent.
    expect(service.surveys.size).toBe(0);
    expect(transcript.cleanup).toEqual({ outcome: "not needed" });
  });

  it("uses the created survey's ids and the instance id of the response with the client id", async () => {
    for (const old of [false, true]) {
      const service = fakeService({ old });
      await runSmoke(OLD, KEY, { fetch: service.fetch });
      const [create, changeJson, changeName, publish, post, postWithClient, upload, results] =
        service.calls;
      const deleteResult = service.calls[8]!;
      const id = publish!.url.pathname.split("/").pop()!;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(create!.url.searchParams.get("accessKey")).toBe(KEY);
      const definition = JSON.parse(String(changeJson!.body)) as { Id: string; Json: string };
      expect(definition.Id).toBe(id);
      expect(definition.Json).toContain('"type":"file"');
      expect(changeName!.url.searchParams.get("id")).toBe(id);
      const postId = (JSON.parse(String(post!.body)) as { postId: string }).postId;
      expect(postId).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.parse(String(postWithClient!.body))).toMatchObject({
        postId,
        clientId: "legacy-replay-smoke",
      });
      expect((upload!.body as FormData).get("postId")).toBe(postId);
      expect(((upload!.body as FormData).get("file") as File).name).toBe("smoke.pdf");
      expect(results!.url.pathname).toBe(`/private/v1/Surveys/getSurveyResults/${id}`);
      expect(deleteResult.url.searchParams.get("postId")).toBe(postId);
      const withClient = service.rows.find((row) => row.ClientId === "legacy-replay-smoke");
      expect(deleteResult.url.searchParams.get("instanceId")).toBe(withClient!.InstanceId);
    }
  });

  it("deletes its own survey when the sequence stops, and only that survey", async () => {
    const service = fakeService({
      override: (action) => (action === "publish" ? new Error("socket hang up") : undefined),
    });
    const transcript = await runSmoke(OLD, KEY, { fetch: service.fetch });

    expect(transcript.steps.map((step) => step.step)).toEqual([
      "create",
      "changeJson",
      "changeName",
      "publish",
    ]);
    expect(transcript.steps[3]!.error).toContain("socket hang up");
    expect(transcript.stopped).toBe("publish: the request failed");
    const last = service.calls.at(-1)!;
    const { Id: id } = JSON.parse(String(service.calls[1]!.body)) as { Id: string };
    expect(`${last.method} ${last.url.pathname}`).toBe(`DELETE /private/Surveys/delete/${id}`);
    expect(last.redirect).toBe("manual");
    expect(transcript.cleanup).toEqual({ outcome: "deleted", surveyId: id });
    expect(service.surveys.size).toBe(0);
  });

  it("reports a failed cleanup with the survey to remove by hand", async () => {
    const service = fakeService({
      override: (action) => (action === "delete" ? empty(500) : undefined),
    });
    const transcript = await runSmoke(OLD, KEY, { fetch: service.fetch });

    expect(transcript.steps.at(-1)).toMatchObject({ step: "delete" });
    expect(transcript.steps.at(-1)!.answer!.status).toBe(500);
    const deletes = service.calls.filter((call) => actionOf(call.url) === "delete");
    expect(deletes).toHaveLength(2);
    const [id] = [...service.surveys.keys()];
    expect(deletes.every((call) => call.url.pathname === `/private/Surveys/delete/${id}`)).toBe(
      true,
    );
    expect(transcript.cleanup).toEqual({ outcome: "failed", surveyId: id, reason: "status 500" });
  });

  it("stops without a cleanup when the create answer names no survey", async () => {
    const service = fakeService({
      override: (action) =>
        action === "create" ? json({ Id: "../generateAccessKey" }) : undefined,
    });
    const transcript = await runSmoke(OLD, KEY, { fetch: service.fetch });

    expect(service.calls).toHaveLength(1);
    expect(transcript.stopped).toBe("create: the answer names no survey id and post id");
    expect(transcript.cleanup).toEqual({
      outcome: "failed",
      reason: `no survey id: look for the survey named "${transcript.name}"`,
    });
  });

  it("sends nothing more after a refused create, which created nothing", async () => {
    const service = fakeService({
      override: (action) => (action === "create" ? empty(401) : undefined),
    });
    const transcript = await runSmoke(OLD, KEY, { fetch: service.fetch });
    expect(service.calls).toHaveLength(1);
    expect(transcript.cleanup).toEqual({ outcome: "not needed" });
  });

  it("never keeps the key, even where an answer echoes it", async () => {
    const service = fakeService({
      override: (action, url) =>
        action === "changeName"
          ? new Response(`The accessKey '${url.searchParams.get("accessKey")}' is incorrect.`, {
              status: 400,
            })
          : action === "archive"
            ? new Error(`connect ECONNREFUSED ${url.href}`)
            : undefined,
    });
    const transcript = await runSmoke(OLD, KEY, { fetch: service.fetch });

    const text = JSON.stringify(transcript, (_, value: unknown) =>
      Buffer.isBuffer(value) ? value.toString("latin1") : value,
    );
    expect(transcript.steps.find((step) => step.step === "changeName")!.answer!.status).toBe(400);
    expect(transcript.steps.at(-1)!.error).toContain("ECONNREFUSED");
    expect(text).not.toMatch(new RegExp(KEY, "i"));
    for (const step of transcript.steps) {
      expect(step.answer?.body.toString("latin1") ?? "").not.toContain(KEY);
    }
  });
});

const steps = (transcript: SmokeTranscript) => transcript.steps.map((step) => step.step);

describe("normalize and compareSmoke", () => {
  it("finds two runs the same when only ids, dates, names and the response order differ", async () => {
    const old = await runSmoke(OLD, KEY, { fetch: fakeService({ old: true }).fetch });
    const bridge = await runSmoke(BRIDGE, KEY, { fetch: fakeService().fetch });

    const comparison = compareSmoke(old, bridge);
    expect(comparison.steps.map((step) => step.step)).toEqual(SMOKE_STEPS);
    expect(comparison.steps.filter((step) => step.outcome !== "same")).toEqual([]);
    expect(comparison.verdict).toBe("pass");
  });

  it("replaces ids, dates, file names and the name's time by placeholders", () => {
    const answer = (value: unknown): Answer => ({
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: Buffer.from(JSON.stringify(value)),
    });
    const transcript: SmokeTranscript = {
      name: "legacy-replay smoke 2026-11-23T10:00:00.000Z",
      steps: [
        {
          step: "create",
          action: "create",
          answer: answer({
            Name: "legacy-replay smoke 2026-11-23T10:00:00.000Z",
            Id: "5AF48E08-A0A5-44A5-83F4-1C90E8E98DE1",
            CreatedAt: "2026-11-23T11:00:00.1234567",
            IsPublished: null,
          }),
        },
        { step: "upload", action: "upload", answer: answer("dxsfile:abc0123.pdf") },
        {
          step: "getSurveyResults",
          action: "getSurveyResults",
          answer: answer({ Data: [{ HappendAt: "2026-11-23T10:00:01Z" }] }),
        },
      ],
      cleanup: { outcome: "not needed" },
    };
    const bodies = normalize(transcript).steps.map((step) =>
      JSON.parse(step.answer!.body.toString("utf8")),
    );
    expect(bodies).toEqual([
      {
        Name: "legacy-replay smoke <time>",
        Id: "<guid>",
        CreatedAt: "<iso>",
        // The old create left it null (docs/api/legacy-compat.md, survey records).
        IsPublished: "<not compared>",
      },
      "dxsfile:<name>.pdf",
      { Data: [{ HappendAt: "<iso>Z" }] },
    ]);
  });

  it("names the step whose answer differs", async () => {
    const old = await runSmoke(OLD, KEY, { fetch: fakeService({ old: true }).fetch });
    const bridge = await runSmoke(BRIDGE, KEY, {
      fetch: fakeService({ override: (action) => (action === "restore" ? empty(400) : undefined) })
        .fetch,
    });

    const comparison = compareSmoke(old, bridge);
    const differing = comparison.steps.filter((step) => step.outcome !== "same");
    expect(differing).toEqual([
      {
        step: "restore",
        outcome: "different",
        differences: [{ at: "status", expected: 200, actual: 400 }],
      },
    ]);
    expect(comparison.verdict).toBe("fail");
  });

  it("counts a failed request and the steps one side did not run", async () => {
    const old = await runSmoke(OLD, KEY, { fetch: fakeService({ old: true }).fetch });
    const bridge = await runSmoke(BRIDGE, KEY, {
      fetch: fakeService({
        override: (action) => (action === "archive" ? new Error("fetch failed") : undefined),
      }).fetch,
    });
    expect(steps(bridge).at(-1)).toBe("archive");

    const comparison = compareSmoke(old, bridge);
    expect(
      comparison.steps
        .filter((step) => step.outcome !== "same")
        .map((step) => `${step.step} ${step.outcome}`),
    ).toEqual(["archive error", "restore not run", "delete not run"]);
    expect(comparison.verdict).toBe("fail");
  });
});

describe("legacy:replay smoke", () => {
  /** Runs the command: the old service and the bridge each a fake service of their own. */
  async function run(
    args: string[],
    options: { env?: Record<string, string>; old?: ServiceOptions; bridge?: ServiceOptions } = {},
  ) {
    const old = fakeService({ old: true, ...options.old });
    const bridge = fakeService(options.bridge);
    const order: string[] = [];
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const side = String(input).startsWith(OLD) ? "old" : "bridge";
      order.push(side);
      return (side === "old" ? old : bridge).fetch(input, init);
    }) as typeof globalThis.fetch;
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(
      args,
      { out: (text) => out.push(text), err: (text) => err.push(text) },
      { fetch, env: options.env ?? { SMOKE_ACCESS_KEY: KEY } },
    );
    return { code, out: out.join(""), err: err.join(""), order };
  }
  const ARGS = ["--", "smoke", "--old", OLD, "--bridge", BRIDGE];

  it("runs the old service first, then the bridge, and prints each step and the verdict", async () => {
    const result = await run(ARGS);
    expect(result.code).toBe(0);
    expect(result.order).toEqual([...Array(13).fill("old"), ...Array(13).fill("bridge")]);
    for (const step of SMOKE_STEPS)
      expect(result.out).toMatch(new RegExp(`^${step.replace(/[()]/g, "\\$&")} +same$`, "m"));
    expect(result.out).toContain("cleanup old: not needed");
    expect(result.out).toContain("cleanup bridge: not needed");
    expect(result.out).toMatch(/^verdict: pass$/m);
    expect(result.out + result.err).not.toMatch(new RegExp(KEY, "i"));
  });

  it("reports a failed cleanup apart, and exits by the comparison", async () => {
    const failingDelete: ServiceOptions = {
      override: (action) => (action === "delete" ? empty(500) : undefined),
    };
    const same = await run(ARGS, { old: failingDelete, bridge: failingDelete });
    expect(same.code).toBe(0);
    expect(same.out).toMatch(
      /^cleanup old: failed \(status 500\); remove survey [0-9a-f-]{36} \("legacy-replay smoke [^"]+"\) by hand$/m,
    );
    expect(same.out).toMatch(/^cleanup bridge: failed \(status 500\); remove survey /m);
    expect(same.out).toMatch(/^verdict: pass$/m);

    const different = await run(ARGS, {
      bridge: {
        override: (action) =>
          action === "publish" ? empty(400) : action === "delete" ? empty(500) : undefined,
      },
    });
    expect(different.code).toBe(1);
    expect(different.out).toMatch(/^publish +different$/m);
    expect(different.out).toContain("  status: old 200, bridge 400");
    expect(different.out).toContain("cleanup old: not needed");
    expect(different.out).toMatch(/^cleanup bridge: failed \(status 500\)/m);
    expect(different.out).toMatch(/^delete +different$/m);
    expect(different.out).toMatch(/^verdict: fail \(2 different, 0 errors, 0 not run\)$/m);
    expect(different.out + different.err).not.toMatch(new RegExp(KEY, "i"));
  });

  it("refuses to run without SMOKE_ACCESS_KEY, sending nothing", async () => {
    const result = await run(ARGS, { env: {} });
    expect(result.code).toBe(2);
    expect(result.err).toContain("SMOKE_ACCESS_KEY is not set");
    expect(result.order).toEqual([]);
  });

  it("takes the key from nowhere but the environment", async () => {
    const result = await run([...ARGS, "--key", KEY], { env: {} });
    expect(result.code).toBe(2);
    expect(result.order).toEqual([]);
    expect(result.err).not.toContain(KEY);
  });

  it("shows its usage on --help, sending nothing", async () => {
    const result = await run(["smoke", "--help"], { env: {} });
    expect(result.code).toBe(0);
    expect(result.out).toContain("Usage: SMOKE_ACCESS_KEY=… pnpm legacy:replay smoke");
    expect(result.order).toEqual([]);
  });

  it("refuses an --old or --bridge that is not an origin", async () => {
    for (const args of [
      ["smoke", "--old", `${OLD}/private`, "--bridge", BRIDGE],
      ["smoke", "--old", OLD],
      ["smoke", "--old", "ftp://old.example", "--bridge", BRIDGE],
    ]) {
      const result = await run(args);
      expect(result.code).toBe(2);
      expect(result.order).toEqual([]);
    }
  });
});
