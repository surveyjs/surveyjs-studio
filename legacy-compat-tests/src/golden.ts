// Golden files: their shape, how a request is built from one, and how an answer is compared with
// one after masking. Pure apart from reading the files; shared by the tests (src/harness.ts) and
// the recording script (scripts/record.ts).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The golden files' folder: `golden/<action>/<case>.json`. */
export const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "golden");

/** A multipart part: a field (`value`) or a file (`filename` with `base64` or `text`). */
export interface Part {
  readonly name: string;
  readonly value?: string;
  readonly filename?: string;
  readonly contentType?: string;
  readonly base64?: string;
  readonly text?: string;
}

/** A request body: text sent as is, JSON (serialised), bytes, or a multipart form. */
export type RequestBody =
  | { readonly text: string }
  | { readonly json: unknown }
  | { readonly base64: string }
  | { readonly multipart: readonly Part[] };

export interface GoldenRequest {
  readonly method: string;
  /** The path as sent (letter case, trailing slash and escapes kept). */
  readonly path: string;
  /** Query parameters (a list value repeats the name), or the raw query string without `?`. */
  readonly query?: Readonly<Record<string, string | readonly string[]>> | string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: RequestBody;
}

/**
 * The expected body: `null` for an empty body; JSON compared as values (key order ignored);
 * text compared as a string; bytes compared exactly.
 */
export type ResponseBody =
  null | { readonly json: unknown } | { readonly text: string } | { readonly base64: string };

export interface GoldenResponse {
  readonly status: number;
  /** The headers callers depend on, lower-case names; `null` means the header is absent. */
  readonly headers: Readonly<Record<string, string | null>>;
  readonly body: ResponseBody;
}

/** A post through the old `post` action to the case's survey, before the request. */
export interface SetupPost {
  readonly surveyResult: string;
  readonly clientId?: string;
  readonly isPartialCompleted?: boolean;
}

/** An upload through the old `upload` action to the case's survey; its answer becomes `{{as}}`. */
export interface SetupUpload {
  readonly as: string;
  readonly filename: string;
  readonly contentType: string;
  readonly base64: string;
}

/** The kinds of a survey's shared results layout (ADR 0040 point 4). */
export type LayoutKind = "table" | "summary" | "columns";

/** The case's own survey: made by the owner with the feedback definition, then changed so. */
export interface SetupSurvey {
  /** Studio's settings (publicResults, storeRespondentIp, privateResultQuestions, useCookies). */
  readonly settings?: Readonly<Record<string, unknown>>;
  /** The fixture project to make it in (the owner is one of its admins); Personal without. */
  readonly projectId?: string;
  /** Its theme. */
  readonly theme?: Readonly<Record<string, unknown>>;
  /** Its shared results layouts, each text as stored. */
  readonly layouts?: Readonly<Partial<Record<LayoutKind, string>>>;
  /** Archived after everything else. */
  readonly archived?: boolean;
}

/**
 * State a case needs: a survey of its own (`{{survey.surveyId}}`, `{{survey.postId}}`,
 * `{{survey.resultId}}`), created with the fixture feedback definition and set up as `survey`
 * says, then posts and uploads. After the posts, `{{survey.responseId}}` is the ID of the first
 * stored response (its `InstanceId`). An upload answered `"dxsimage:x.png"` sets `{{<as>}}` to
 * `dxsimage:x.png` and `{{<as>.name}}` to `x.png`.
 */
export interface GoldenSetup {
  readonly survey: SetupSurvey;
  readonly posts?: readonly SetupPost[];
  readonly uploads?: readonly SetupUpload[];
}

/** The definition of the fixture "Customer feedback", given to the cases' own surveys. */
export const FEEDBACK_DEFINITION = {
  title: "Customer feedback",
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

/** The name of the cases' own surveys. */
export const SETUP_SURVEY_NAME = "Legacy compat";

/**
 * The variables naming access keys (ADR 0040): `{{accessKey}}` is the survey owner's key (the
 * test account's when recording), `{{memberKey}}` a project member's who is neither a project
 * admin nor the survey's creator, and `{{revokedKey}}` a key that no longer works. A request
 * that holds one is a keyed request.
 */
export const KEY_VARIABLES = ["accessKey", "memberKey", "revokedKey"] as const;

/** Whether the request carries an access key variable. */
export function isKeyed(request: GoldenRequest): boolean {
  const text = JSON.stringify(request);
  return KEY_VARIABLES.some((name) => text.includes(`{{${name}}}`));
}

export interface Golden {
  /** `derived` from the old code and ADR 0039's differences; `recorded` from the real old API. */
  readonly source: "derived" | "recorded";
  readonly description: string;
  /**
   * How the old API answered where the bridge differs on purpose (ADR 0039 and its records), for
   * the reviewers of recordings; not compared.
   */
  readonly difference?: string;
  /**
   * A mismatch between the bridge and the old answer that no listed difference explains, reported
   * and not yet settled: the case is expected to fail until the bridge answers as the golden says
   * (then the note goes).
   */
  readonly knownMismatch?: string;
  /**
   * Why the recording script must not replay the case against the old API (it would leave
   * something there that no action removes); the script skips it.
   */
  readonly noRecording?: string;
  /** The Studio providers the case can run on (default: all), with why when limited. */
  readonly providers?: readonly ("memory" | "azure-legacy")[];
  readonly providersNote?: string;
  readonly setup?: GoldenSetup;
  /**
   * The request makes surveys (`create`, `clone`): every survey that appears while it runs is
   * removed afterwards.
   */
  readonly creates?: boolean;
  readonly request: GoldenRequest;
  readonly response: GoldenResponse;
}

export interface GoldenCase {
  /** `<action>/<case>`, the path under `golden/` without `.json`. */
  readonly name: string;
  readonly golden: Golden;
}

/** Reads every golden file of the actions (all of them when none are named), sorted by name. */
export function loadGoldens(actions?: readonly string[]): GoldenCase[] {
  const folders = actions ?? readdirSync(GOLDEN_DIR).sort();
  const cases: GoldenCase[] = [];
  for (const action of folders) {
    for (const file of readdirSync(join(GOLDEN_DIR, action)).sort()) {
      if (!file.endsWith(".json")) continue;
      const golden = JSON.parse(readFileSync(join(GOLDEN_DIR, action, file), "utf8")) as Golden;
      cases.push({ name: `${action}/${file.slice(0, -".json".length)}`, golden });
    }
  }
  return cases;
}

// ---- Variables: `{{name}}` in requests and expected strings ----

const VARIABLE = /\{\{([A-Za-z0-9_.]+|[A-Za-z0-9]\*[0-9]{1,8})\}\}/g;

/**
 * Replaces each `{{name}}` in every string of `value`; an unknown name is an error. `{{c*n}}` is
 * the character `c` repeated `n` times (large bodies without large files).
 */
export function substitute<T>(value: T, vars: Readonly<Record<string, string>>): T {
  if (typeof value === "string") {
    return value.replace(VARIABLE, (_match, name: string) => {
      const star = name.indexOf("*");
      if (star === 1) return name.charAt(0).repeat(Number(name.slice(2)));
      const found = vars[name];
      if (found === undefined) throw new Error(`no value for {{${name}}}`);
      return found;
    }) as T;
  }
  if (Array.isArray(value)) return value.map((item: unknown) => substitute(item, vars)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitute(item, vars)]),
    ) as T;
  }
  return value;
}

// ---- Building the request ----

const BOUNDARY = "----legacy-compat-boundary-7d1f3c";

function multipart(parts: readonly Part[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition =
      part.filename === undefined
        ? `form-data; name="${part.name}"`
        : `form-data; name="${part.name}"; filename="${part.filename}"`;
    const type = part.contentType === undefined ? "" : `Content-Type: ${part.contentType}\r\n`;
    chunks.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: ${disposition}\r\n${type}\r\n`));
    chunks.push(
      part.base64 !== undefined
        ? Buffer.from(part.base64, "base64")
        : Buffer.from(part.text ?? part.value ?? "", "utf8"),
    );
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

/** The URL of a request against `baseUrl` (the old API's origin). */
export function requestUrl(baseUrl: string, request: GoldenRequest): string {
  let query = "";
  if (typeof request.query === "string") {
    query = request.query;
  } else if (request.query !== undefined) {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(request.query)) {
      for (const item of typeof value === "string" ? [value] : value) params.append(name, item);
    }
    query = params.toString();
  }
  return `${baseUrl}${request.path}${query === "" ? "" : `?${query}`}`;
}

/** The fetch options of a request: method, headers and body (a multipart form gets its boundary). */
export function requestInit(request: GoldenRequest): RequestInit {
  const headers: Record<string, string> = { ...request.headers };
  let body: Buffer | undefined;
  const given = request.body;
  if (given !== undefined) {
    if ("text" in given) body = Buffer.from(given.text, "utf8");
    else if ("json" in given) body = Buffer.from(JSON.stringify(given.json), "utf8");
    else if ("base64" in given) body = Buffer.from(given.base64, "base64");
    else {
      body = multipart(given.multipart);
      const named = Object.keys(headers).some((name) => name.toLowerCase() === "content-type");
      if (!named) headers["content-type"] = `multipart/form-data; boundary=${BOUNDARY}`;
    }
  }
  return {
    method: request.method,
    redirect: "manual",
    headers,
    ...(body !== undefined && { body: new Uint8Array(body) }),
  };
}

// ---- Comparing ----

/**
 * Placeholders for volatile parts, usable inside any expected string (header, text or JSON
 * string): `<guid>`, `<hex64>` (a Studio file ID), `<iso>` (a date and time without a zone, up to
 * 7 fractional digits; the golden adds `Z` where the answer has it) and `<any>`. The JSON string
 * `"<any>"` matches any JSON string, and only a string (e.g. a ProblemDetails `traceId`).
 */
const PLACEHOLDERS: Readonly<Record<string, string>> = {
  "<guid>": "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
  "<hex64>": "[0-9a-f]{64}",
  "<iso>": "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,7})?",
  "<any>": "[\\s\\S]*",
};
const PLACEHOLDER = /<guid>|<hex64>|<iso>|<any>/g;

/** Whether `actual` matches the expected string with its placeholders. */
export function matchesText(expected: string, actual: string): boolean {
  if (!expected.includes("<")) return expected === actual;
  let pattern = "";
  let last = 0;
  for (const match of expected.matchAll(PLACEHOLDER)) {
    pattern += escapeRegExp(expected.slice(last, match.index)) + PLACEHOLDERS[match[0]];
    last = match.index + match[0].length;
  }
  pattern += escapeRegExp(expected.slice(last));
  return new RegExp(`^${pattern}$`).test(actual);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One place where an answer differs from its golden file: a path such as `body.json.errors.x`. */
export interface Difference {
  readonly at: string;
  readonly expected: unknown;
  readonly actual: unknown;
}

function compareJson(expected: unknown, actual: unknown, at: string, out: Difference[]): void {
  if (typeof expected === "string") {
    if (typeof actual !== "string" || !matchesText(expected, actual)) {
      out.push({ at, expected, actual });
    }
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      out.push({ at, expected, actual });
      return;
    }
    expected.forEach((item: unknown, index) =>
      compareJson(item, actual[index], `${at}[${index}]`, out),
    );
    return;
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
      out.push({ at, expected, actual });
      return;
    }
    const want = expected as Record<string, unknown>;
    const got = actual as Record<string, unknown>;
    for (const key of new Set([...Object.keys(want), ...Object.keys(got)])) {
      if (!Object.hasOwn(want, key) || !Object.hasOwn(got, key)) {
        out.push({ at: `${at}.${key}`, expected: want[key], actual: got[key] });
      } else {
        compareJson(want[key], got[key], `${at}.${key}`, out);
      }
    }
    return;
  }
  if (!Object.is(expected, actual)) out.push({ at, expected, actual });
}

/** An answer as read: status, headers (lower-case names) and the body's bytes. */
export interface Answer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
}

export async function readAnswer(response: Response): Promise<Answer> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => (headers[name] = value));
  return { status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) };
}

/** Every difference between an answer and the golden response; empty when it matches. */
export function compareAnswer(expected: GoldenResponse, answer: Answer): Difference[] {
  const out: Difference[] = [];
  if (expected.status !== answer.status) {
    out.push({ at: "status", expected: expected.status, actual: answer.status });
  }
  for (const [name, value] of Object.entries(expected.headers)) {
    const actual = answer.headers[name.toLowerCase()];
    const same =
      value === null ? actual === undefined : actual !== undefined && matchesText(value, actual);
    if (!same) out.push({ at: `headers.${name}`, expected: value, actual: actual ?? null });
  }
  const body = expected.body;
  if (body === null) {
    if (answer.body.length > 0)
      out.push({ at: "body", expected: "", actual: answer.body.toString("utf8") });
  } else if ("json" in body) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(answer.body.toString("utf8"));
    } catch {
      out.push({ at: "body.json", expected: body.json, actual: answer.body.toString("utf8") });
      return out;
    }
    compareJson(body.json, parsed, "body.json", out);
  } else if ("text" in body) {
    const text = answer.body.toString("utf8");
    if (!matchesText(body.text, text))
      out.push({ at: "body.text", expected: body.text, actual: text });
  } else if (!answer.body.equals(Buffer.from(body.base64, "base64"))) {
    out.push({ at: "body.base64", expected: body.base64, actual: answer.body.toString("base64") });
  }
  return out;
}

/** An answer written as a golden response: the named headers, the body in the golden's form. */
export function answerAsGolden(
  answer: Answer,
  headerNames: readonly string[],
  form: "json" | "text" | "base64" | null,
): GoldenResponse {
  const headers: Record<string, string | null> = {};
  for (const name of headerNames) headers[name] = answer.headers[name.toLowerCase()] ?? null;
  let body: ResponseBody;
  if (answer.body.length === 0) body = null;
  else if (form === "json") {
    try {
      body = { json: JSON.parse(answer.body.toString("utf8")) as unknown };
    } catch {
      body = { text: answer.body.toString("utf8") };
    }
  } else if (form === "base64") body = { base64: answer.body.toString("base64") };
  else body = { text: answer.body.toString("utf8") };
  return { status: answer.status, headers, body };
}
