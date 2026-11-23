// `pnpm legacy:replay smoke` (ADR 0041 point 3): the old service's write actions, in a fixed
// sequence, with the test account's key, on a survey the run creates. It runs once against the old
// service and once against the bridge, each on its own new survey; the two transcripts are
// normalized (ids, dates, generated names) and compared answer by answer. The run deletes only the
// survey it created, by the id `create` answered. The key never leaves this module: answers and
// errors are kept with it masked, as in the replay (run.ts).
import { compareAnswers, type Answer, type Difference } from "./compare.js";
import { describeError, readAnswer, scrubberOf } from "./run.js";

/** The smoke survey's name, followed by the run's start time: a leftover can be found by it. */
export const SMOKE_NAME = "legacy-replay smoke";

/** The client id of the second `post`, and of the response `deleteResult` deletes. */
const CLIENT_ID = "legacy-replay-smoke";

/** A rating and a file question: `upload` needs a file question. */
const DEFINITION = {
  title: "legacy-replay smoke",
  pages: [
    {
      name: "page1",
      elements: [
        { type: "rating", name: "satisfaction", title: "How satisfied are you?" },
        { type: "file", name: "receipt", title: "Upload your receipt" },
      ],
    },
  ],
};

const UPLOAD = {
  name: "smoke.pdf",
  type: "application/pdf",
  text: "%PDF-1.4\n% legacy-replay smoke\n",
};

/** The steps, in the order they run; `post (clientId)` is the second `post`. */
export const SMOKE_STEPS: readonly string[] = [
  "create",
  "changeJson",
  "changeName",
  "publish",
  "post",
  "post (clientId)",
  "upload",
  "getSurveyResults",
  "deleteResult",
  "deleteAllResults",
  "archive",
  "restore",
  "delete",
];

/** How long one request may take. */
const REQUEST_TIMEOUT_MS = 30_000;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SmokeStep {
  readonly step: string;
  /** The legacy action, for `compareAnswers`. */
  readonly action: string;
  /** The answer, the key masked; absent when the request failed. */
  readonly answer?: Answer;
  /** Why the request failed, the key masked. */
  readonly error?: string;
}

export type Cleanup =
  /** The sequence's own `delete` removed the survey, or `create` refused and created none. */
  | { readonly outcome: "not needed" }
  | { readonly outcome: "deleted"; readonly surveyId: string }
  /** The survey may be left: remove it by hand (by id, or by name when the id is unknown). */
  | { readonly outcome: "failed"; readonly surveyId?: string; readonly reason: string };

export interface SmokeTranscript {
  /** The survey's name as created (`SMOKE_NAME` and the run's start time). */
  readonly name: string;
  /** The steps that ran, in order. */
  readonly steps: readonly SmokeStep[];
  /** Why the sequence stopped before its last step. */
  readonly stopped?: string;
  readonly cleanup: Cleanup;
}

export interface SmokeOptions {
  fetch?: typeof globalThis.fetch;
}

interface SmokeRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  /** Query parameters besides the key. */
  query?: Record<string, string>;
  /** Whether the request carries the key (`accessKey` in the query: the old API reads it there). */
  keyed?: boolean;
  json?: unknown;
  form?: FormData;
}

class Stop extends Error {}

const isSuccess = (answer: Answer) => answer.status >= 200 && answer.status < 300;

function jsonOf(answer: Answer): unknown {
  try {
    return JSON.parse(answer.body.toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
}

const field = (value: unknown, name: string): unknown =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)[name]
    : undefined;

const guidOf = (value: unknown) =>
  typeof value === "string" && GUID.test(value) ? value : undefined;

/**
 * Runs the sequence against `baseUrl` (an origin) with `key`, then deletes the survey when the
 * sequence did not. A request that fails stops the sequence; an answer of any status does not,
 * unless a later step needs what it lacks.
 */
export async function runSmoke(
  baseUrl: string,
  key: string,
  options: SmokeOptions = {},
): Promise<SmokeTranscript> {
  const fetch = options.fetch ?? globalThis.fetch;
  const scrub = scrubberOf([{ key, recorded: encodeURIComponent(key) }]);
  const name = `${SMOKE_NAME} ${new Date().toISOString()}`;
  const steps: SmokeStep[] = [];
  let stopped: string | undefined;
  let surveyId: string | undefined;
  /** Whether a survey may exist without its id: `create` failed, or succeeded without an id. */
  let createdUnknown = true;
  let deleted = false;

  const send = async (request: SmokeRequest): Promise<Answer> => {
    const url = new URL(request.path, baseUrl);
    if (request.keyed) url.searchParams.set("accessKey", key);
    for (const [parameter, value] of Object.entries(request.query ?? {})) {
      url.searchParams.set(parameter, value);
    }
    const init: RequestInit = {
      method: request.method,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (request.json !== undefined) {
      init.headers = { "content-type": "application/json; charset=utf-8" };
      init.body = JSON.stringify(request.json);
    } else if (request.form) {
      init.body = request.form;
    }
    return readAnswer(await fetch(url.href, init));
  };

  const step = async (stepName: string, action: string, request: SmokeRequest) => {
    let answer: Answer;
    try {
      answer = await send(request);
    } catch (error) {
      steps.push({ step: stepName, action, error: scrub.value(describeError(error)) });
      throw new Stop(`${stepName}: the request failed`);
    }
    steps.push({ step: stepName, action, answer: scrub.answer(answer) });
    return answer;
  };

  const survey = (action: string) => `/private/v1/Surveys/${action}/${surveyId!}`;

  let cleanup: Cleanup;
  try {
    const created = await step("create", "create", {
      method: "POST",
      path: "/private/v1/Surveys/create",
      keyed: true,
      query: { name },
    });
    const record = jsonOf(created);
    surveyId = guidOf(field(record, "Id"));
    const postId = guidOf(field(record, "PostId"));
    createdUnknown = isSuccess(created) && surveyId === undefined;
    if (surveyId === undefined || postId === undefined) {
      throw new Stop("create: the answer names no survey id and post id");
    }

    await step("changeJson", "changeJson", {
      method: "PUT",
      path: "/private/v1/Surveys/changeJson",
      keyed: true,
      json: { Id: surveyId, Json: JSON.stringify(DEFINITION) },
    });
    await step("changeName", "changeName", {
      method: "PUT",
      path: "/private/v1/Surveys/changeName",
      keyed: true,
      query: { id: surveyId, name: `${name} renamed` },
    });
    await step("publish", "publish", { method: "PUT", path: survey("publish"), keyed: true });
    const result = (satisfaction: number) => JSON.stringify({ satisfaction });
    await step("post", "post", {
      method: "POST",
      path: "/public/v1/Survey/post/",
      json: { postId, surveyResult: result(4) },
    });
    await step("post (clientId)", "post", {
      method: "POST",
      path: "/public/v1/Survey/post/",
      json: { postId, surveyResult: result(2), clientId: CLIENT_ID },
    });
    const form = new FormData();
    form.append("file", new Blob([UPLOAD.text], { type: UPLOAD.type }), UPLOAD.name);
    form.append("postId", postId);
    await step("upload", "upload", { method: "POST", path: "/public/v1/Survey/upload/", form });
    const results = await step("getSurveyResults", "getSurveyResults", {
      method: "GET",
      path: survey("getSurveyResults"),
      keyed: true,
    });
    // The response posted with the client id, wherever the answer lists it.
    const rows = field(jsonOf(results), "Data");
    const row = Array.isArray(rows)
      ? (rows.find((item) => field(item, "ClientId") === CLIENT_ID) as unknown)
      : undefined;
    const instanceId = field(row, "InstanceId");
    if (typeof instanceId !== "string" || instanceId === "") {
      throw new Stop("getSurveyResults: the answer lists no response with the client id");
    }
    await step("deleteResult", "deleteResult", {
      method: "DELETE",
      path: "/private/v1/Surveys/deleteResult",
      keyed: true,
      query: { postId, instanceId },
    });
    await step("deleteAllResults", "deleteAllResults", {
      method: "DELETE",
      path: survey("deleteAllResults"),
      keyed: true,
    });
    await step("archive", "archive", { method: "PUT", path: survey("archive"), keyed: true });
    await step("restore", "restore", { method: "PUT", path: survey("restore"), keyed: true });
    deleted = isSuccess(
      await step("delete", "delete", {
        method: "DELETE",
        path: `/private/Surveys/delete/${surveyId}`,
        keyed: true,
      }),
    );
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    stopped = error.message;
  } finally {
    cleanup = await cleanUp();
  }
  return { name, steps, ...(stopped !== undefined && { stopped }), cleanup };

  async function cleanUp(): Promise<Cleanup> {
    if (deleted) return { outcome: "not needed" };
    if (surveyId === undefined) {
      return createdUnknown
        ? { outcome: "failed", reason: `no survey id: look for the survey named "${name}"` }
        : { outcome: "not needed" };
    }
    try {
      const answer = await send({
        method: "DELETE",
        path: `/private/Surveys/delete/${surveyId}`,
        keyed: true,
      });
      return isSuccess(answer)
        ? { outcome: "deleted", surveyId }
        : { outcome: "failed", surveyId, reason: `status ${answer.status}` };
    } catch (error) {
      return { outcome: "failed", surveyId, reason: scrub.value(describeError(error)) };
    }
  }
}

/**
 * What differs by design between two runs, replaced by placeholders, in this order: the survey's
 * name (its time), stored file names (the old API's a GUID, the bridge's Studio's file ID), GUIDs
 * and date-times (an offset or `Z` after one is kept, so a changed time zone form still shows).
 */
const TEXT_RULES: readonly (readonly [RegExp, string])[] = [
  [/legacy-replay smoke [^\s"]+/g, `${SMOKE_NAME} <time>`],
  [/(dxs(?:file|image):)[^\s".]+/g, "$1<name>"],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<guid>"],
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?/g, "<iso>"],
];

/**
 * By action, the answer's top-level JSON properties not compared, each a difference listed in
 * docs/api/legacy-compat.md: `create`'s `IsPublished` was `null` in the old API until the survey was
 * published or unpublished once; the bridge answers Studio's flag.
 */
const NOT_COMPARED: Readonly<Record<string, readonly string[]>> = { create: ["IsPublished"] };

/**
 * The arrays `compareAnswers` compares as multisets: the old `getSurveyResults` listed rows in its
 * storage's order, random by row key; the bridge lists them oldest first (docs/api/legacy-compat.md).
 */
const SMOKE_UNORDERED: Readonly<Record<string, readonly string[]>> = {
  getSurveyResults: ["body.json.Data"],
};

const normalizeText = (text: string) =>
  TEXT_RULES.reduce((result, [pattern, placeholder]) => result.replace(pattern, placeholder), text);

function normalizeJson(value: unknown): unknown {
  if (typeof value === "string") return normalizeText(value);
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([name, inner]) => [normalizeText(name), normalizeJson(inner)]),
    );
  }
  return value;
}

function normalizeAnswer(answer: Answer, action: string): Answer {
  const headers = Object.fromEntries(
    Object.entries(answer.headers).map(([name, value]) => [name, normalizeText(value)]),
  );
  const media = answer.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() ?? "";
  const parsed = media.endsWith("json") ? jsonOf(answer) : undefined;
  if (parsed === undefined) {
    return {
      status: answer.status,
      headers,
      body: Buffer.from(normalizeText(answer.body.toString("utf8")), "utf8"),
    };
  }
  const value = normalizeJson(parsed);
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const name of NOT_COMPARED[action] ?? []) {
      if (Object.hasOwn(record, name)) record[name] = "<not compared>";
    }
  }
  return { status: answer.status, headers, body: Buffer.from(JSON.stringify(value), "utf8") };
}

/** The transcript with its answers' ids, dates and generated names replaced by placeholders. */
export function normalize(transcript: SmokeTranscript): SmokeTranscript {
  return {
    ...transcript,
    steps: transcript.steps.map((step) =>
      step.answer ? { ...step, answer: normalizeAnswer(step.answer, step.action) } : step,
    ),
  };
}

export type SmokeOutcome = "same" | "different" | "error" | "not run";

export interface SmokeStepResult {
  readonly step: string;
  /** `error`: a request failed on either side; `not run`: a side stopped before this step. */
  readonly outcome: SmokeOutcome;
  readonly differences: readonly Difference[];
  /** The failed requests' errors, by side. */
  readonly error?: string;
}

export interface SmokeComparison {
  readonly steps: readonly SmokeStepResult[];
  /** `pass` only when every step is `same`. */
  readonly verdict: "pass" | "fail";
}

/** Compares the old service's run (expected) with the bridge's, step by step, both normalized. */
export function compareSmoke(old: SmokeTranscript, bridge: SmokeTranscript): SmokeComparison {
  const oldSteps = normalize(old).steps;
  const bridgeSteps = normalize(bridge).steps;
  const steps = SMOKE_STEPS.map((name): SmokeStepResult => {
    const expected = oldSteps.find((step) => step.step === name);
    const actual = bridgeSteps.find((step) => step.step === name);
    if (expected?.error !== undefined || actual?.error !== undefined) {
      const error = [
        expected?.error !== undefined ? `old: ${expected.error}` : undefined,
        actual?.error !== undefined ? `bridge: ${actual.error}` : undefined,
      ].filter((part) => part !== undefined);
      return { step: name, outcome: "error", differences: [], error: error.join("; ") };
    }
    if (!expected?.answer || !actual?.answer) {
      return { step: name, outcome: "not run", differences: [] };
    }
    const differences = compareAnswers(
      expected.answer,
      actual.answer,
      expected.action,
      SMOKE_UNORDERED,
    );
    return { step: name, outcome: differences.length === 0 ? "same" : "different", differences };
  });
  return { steps, verdict: steps.every((step) => step.outcome === "same") ? "pass" : "fail" };
}

/** How much of a differing value the console shows. */
const SHOWN = 200;

function shown(value: unknown): string {
  const text = value === undefined ? "(none)" : JSON.stringify(value);
  return text.length > SHOWN ? `${text.slice(0, SHOWN)}… (${text.length} characters)` : text;
}

function cleanupLine(side: string, transcript: SmokeTranscript): string {
  const { cleanup } = transcript;
  if (cleanup.outcome === "not needed") return `cleanup ${side}: not needed`;
  if (cleanup.outcome === "deleted") return `cleanup ${side}: deleted survey ${cleanup.surveyId}`;
  if (cleanup.surveyId === undefined) return `cleanup ${side}: failed (${cleanup.reason})`;
  return `cleanup ${side}: failed (${cleanup.reason}); remove survey ${cleanup.surveyId} ("${transcript.name}") by hand`;
}

/**
 * The console's text: each step's outcome with its differences (normalized, the key masked), why
 * a side stopped early, each side's cleanup, and the verdict.
 */
export function formatSmoke(
  comparison: SmokeComparison,
  old: SmokeTranscript,
  bridge: SmokeTranscript,
): string {
  const width = Math.max(...SMOKE_STEPS.map((step) => step.length));
  const lines = [`${"step".padEnd(width)}  outcome`];
  for (const result of comparison.steps) {
    lines.push(`${result.step.padEnd(width)}  ${result.outcome}`);
    if (result.error !== undefined) lines.push(`  ${result.error}`);
    for (const difference of result.differences) {
      lines.push(
        `  ${difference.at}: old ${shown(difference.expected)}, bridge ${shown(difference.actual)}`,
      );
    }
  }
  lines.push("");
  for (const [side, transcript] of [
    ["old", old],
    ["bridge", bridge],
  ] as const) {
    if (transcript.stopped !== undefined) lines.push(`stopped ${side}: ${transcript.stopped}`);
  }
  lines.push(cleanupLine("old", old), cleanupLine("bridge", bridge));
  const count = (outcome: SmokeOutcome) =>
    comparison.steps.filter((step) => step.outcome === outcome).length;
  const errors = count("error");
  lines.push(
    comparison.verdict === "pass"
      ? "verdict: pass"
      : `verdict: fail (${count("different")} different, ${errors} error${errors === 1 ? "" : "s"}, ${count("not run")} not run)`,
    "",
  );
  return lines.join("\n");
}
