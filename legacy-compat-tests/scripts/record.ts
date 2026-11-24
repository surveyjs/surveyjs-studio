// Records the real old API's answers to the golden requests, for review in the private location
// (ADR 0039 point 6; plan-hosted rule 6: production data never goes into the repository).
//
//   pnpm --filter @surveyjs-studio/legacy-compat-tests record -- \
//     --base https://api.surveyjs.io --surveys <file> --out <dir> [--only <action>[/<case>]]
//
// `--surveys` is a JSON file of the test account's values:
//
//   {
//     "ids": { "<value in the golden files>": "<the test account's value>", ... },
//     "survey": { "surveyId": "…", "postId": "…", "resultId": "…" },
//     "cases": { "<action>/<case>": { "surveyId": "…", "postId": "…", "resultId": "…" } }
//   }
//
// `ids` maps the fixtures' survey, post and result IDs and legacy file names to the test account's
// (in any letter case, with or without dashes). `survey` is the test account's survey that the
// cases with a `setup` post and upload to; `cases` gives a case a survey of its own (for example one
// with Grant Access and "Save Respondent IP" on, which the script cannot switch). A case whose
// request names a fixture ID without a value in `ids` is skipped.
//
// For each case the script replays the setup and the request against `--base`, maps the test
// account's values in the answer back to the fixtures' and writes `<out>/<action>/<case>.json` with
// `"source": "recorded"`. It prints each case's name, status and whether the answer matches the
// derived golden file (only the places that differ, never a body). It refuses an `--out` inside
// the repository.
import { existsSync, mkdirSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  answerAsGolden,
  compareAnswer,
  loadGoldens,
  readAnswer,
  requestInit,
  requestUrl,
  substitute,
  type Golden,
  type GoldenCase,
  type GoldenRequest,
  type ResponseBody,
} from "../src/golden.js";

const REPOSITORY = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export class UsageError extends Error {}

export interface SurveyIds {
  readonly surveyId: string;
  readonly postId: string;
  readonly resultId: string;
}

export interface SurveysFile {
  readonly ids: Readonly<Record<string, string>>;
  readonly survey?: SurveyIds;
  readonly cases?: Readonly<Record<string, SurveyIds>>;
}

export interface RecordOptions {
  readonly base: string;
  readonly surveys: SurveysFile;
  readonly out: string;
  /** `<action>` or `<action>/<case>`: only those cases. */
  readonly only?: string;
  /** Receives one line per case (never a body). */
  readonly log?: (line: string) => void;
}

/**
 * The real path of `path`: made absolute and normalised (`..` taken lexically), then the part
 * that exists resolved through links and letter case, the rest appended. The script writes to this
 * path, so what it checks is where it writes.
 */
export function realPath(path: string): string {
  let existing = resolve(path);
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    rest.unshift(basename(existing));
    existing = parent;
  }
  return join(realpathSync.native(existing), ...rest);
}

/** Whether `path` is the repository or inside it, after resolving links and letter case. */
export function insideRepository(path: string): boolean {
  const relation = relative(realpathSync.native(REPOSITORY), realPath(path));
  // `..recordings` is a child named with two dots, not the parent.
  const outside = relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation);
  return !outside;
}

/**
 * A failure whose message the script may print: written here, never taken from an answer, so no
 * answer body can reach the output through it.
 */
class CaseError extends Error {}

/** A fixture ID (the fixtures' scheme: the last group starts with `a`), with or without dashes. */
const FIXTURE_ID = /[0-9a-f]{8}-?0000-?4000-?8000-?a[0-9a-f]{11}/gi;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replaces every `from` value in every string, in any letter case and with or without dashes. */
function mapValues<T>(value: T, pairs: readonly (readonly [string, string])[]): T {
  if (typeof value === "string") {
    let text: string = value;
    for (const [from, to] of pairs) {
      const forms: [string, string][] = [[from, to]];
      if (from.includes("-")) forms.push([from.replaceAll("-", ""), to.replaceAll("-", "")]);
      for (const [a, b] of forms) {
        // An upper-case ID maps to an upper-case value; a variable reference is kept as written.
        const upper = (match: string) =>
          match === match.toUpperCase() && match !== match.toLowerCase() && !b.includes("{{");
        text = text.replace(new RegExp(escapeRegExp(a), "gi"), (match) =>
          upper(match) ? b.toUpperCase() : b,
        );
      }
    }
    return text as T;
  }
  if (Array.isArray(value)) return value.map((item: unknown) => mapValues(item, pairs)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [mapValues(key, pairs), mapValues(item, pairs)]),
    ) as T;
  }
  return value;
}

/** Fixture IDs in the request that the surveys file gives no value for. */
function unmappedIds(request: GoldenRequest, ids: Readonly<Record<string, string>>): string[] {
  const known = new Set(Object.keys(ids).map((id) => id.toLowerCase().replaceAll("-", "")));
  const found = JSON.stringify(request).match(FIXTURE_ID) ?? [];
  return [...new Set(found.map((id) => id.toLowerCase().replaceAll("-", "")))].filter(
    (id) => ![...known].some((value) => value.includes(id)),
  );
}

/** Masks the parts of a recorded body that change on every request (ProblemDetails `traceId`). */
function maskVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskVolatile);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === "traceId" && typeof item === "string" ? "<any>" : maskVolatile(item),
      ]),
    );
  }
  return value;
}

function bodyForm(body: ResponseBody): "json" | "text" | "base64" | null {
  if (body === null) return "text";
  if ("json" in body) return "json";
  if ("base64" in body) return "base64";
  return "text";
}

async function call(base: string, request: GoldenRequest) {
  return readAnswer(await fetch(requestUrl(base, request), requestInit(request)));
}

/** Replays the case's setup against the old API; returns its variables. */
async function setUp(
  base: string,
  golden: Golden,
  survey: SurveyIds,
): Promise<Record<string, string>> {
  const vars: Record<string, string> = {
    "survey.surveyId": survey.surveyId,
    "survey.postId": survey.postId,
    "survey.resultId": survey.resultId,
  };
  for (const post of golden.setup?.posts ?? []) {
    const answer = await call(base, {
      method: "POST",
      path: "/public/v1/Survey/post/",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: { json: { postId: survey.postId, ...post } },
    });
    if (answer.status !== 200) throw new CaseError(`the setup post answered ${answer.status}`);
  }
  for (const upload of golden.setup?.uploads ?? []) {
    const answer = await call(base, {
      method: "POST",
      path: "/public/v1/Survey/upload/",
      body: {
        multipart: [
          {
            name: "file",
            filename: upload.filename,
            contentType: upload.contentType,
            base64: upload.base64,
          },
          { name: "postId", value: survey.postId },
        ],
      },
    });
    if (answer.status !== 200) throw new CaseError(`the setup upload answered ${answer.status}`);
    let name: unknown;
    try {
      name = JSON.parse(answer.body.toString("utf8"));
    } catch {
      name = undefined;
    }
    if (typeof name !== "string") {
      throw new CaseError("the setup upload's answer is not a JSON string");
    }
    vars[upload.as] = name;
    vars[`${upload.as}.name`] = name.slice(name.indexOf(":") + 1);
  }
  return vars;
}

/** Records one case into `out` (already resolved); returns the line to print. */
async function recordCase(
  options: RecordOptions,
  out: string,
  { name, golden }: GoldenCase,
): Promise<string> {
  const { base, surveys } = options;
  const missing = unmappedIds(golden.request, surveys.ids);
  if (missing.length > 0)
    return `${name}: skipped (no test-account value for ${missing.join(", ")})`;
  const survey = surveys.cases?.[name] ?? surveys.survey;
  if (golden.setup !== undefined && survey === undefined) {
    return `${name}: skipped (needs "survey" or cases["${name}"] in the surveys file)`;
  }
  const toAccount = Object.entries(surveys.ids);
  const vars =
    survey !== undefined && golden.setup !== undefined ? await setUp(base, golden, survey) : {};
  const request = substitute(mapValues(golden.request, toAccount), vars);
  const answer = await call(base, request);

  const expected = substitute(mapValues(golden.response, toAccount), vars);
  const differences = compareAnswer(expected, answer);

  // Back to the fixtures' values, so the recording can stand in for the derived file.
  const toFixtures: [string, string][] = [
    ...Object.entries(vars).map(([key, value]): [string, string] => [value, `{{${key}}}`]),
    ...toAccount.map(([fixture, account]): [string, string] => [account, fixture]),
  ];
  const recorded = answerAsGolden(
    answer,
    Object.keys(golden.response.headers),
    bodyForm(golden.response.body),
  );
  const body =
    recorded.body !== null && "json" in recorded.body
      ? { json: maskVolatile(recorded.body.json) }
      : recorded.body;
  const file: Golden = {
    source: "recorded",
    description: golden.description,
    ...(golden.setup !== undefined && { setup: golden.setup }),
    request: golden.request,
    response: mapValues({ ...recorded, body }, toFixtures),
  };
  const path = join(out, `${name}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  const verdict =
    differences.length === 0
      ? "matches the derived golden"
      : `differs at ${differences.map((difference) => difference.at).join(", ")}`;
  return `${name}: ${answer.status}, ${verdict}`;
}

/** Records every selected case into `options.out`; returns how many differ or failed. */
export async function record(options: RecordOptions): Promise<number> {
  const out = realPath(options.out);
  if (insideRepository(out)) {
    throw new UsageError(
      "--out is inside the repository; recordings go to the private location (plan-hosted rule 6)",
    );
  }
  const log = options.log ?? ((line: string) => console.log(line));
  const cases = loadGoldens().filter(
    ({ name }) =>
      options.only === undefined || name === options.only || name.startsWith(`${options.only}/`),
  );
  let problems = 0;
  for (const goldenCase of cases) {
    try {
      const line = await recordCase(options, out, goldenCase);
      if (line.includes(": skipped") === false && !line.endsWith("matches the derived golden")) {
        problems += 1;
      }
      log(line);
    } catch (error) {
      problems += 1;
      // Only the script's own texts: another error's message could quote an answer.
      const reason =
        error instanceof CaseError
          ? error.message
          : `${error instanceof Error ? error.name : "error"} while calling --base`;
      log(`${goldenCase.name}: failed (${reason})`);
    }
  }
  return problems;
}

function argument(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const value = args[at + 1];
  if (value === undefined || value.startsWith("--")) throw new UsageError(`${name} needs a value`);
  return value;
}

function readSurveys(path: string): SurveysFile {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SurveysFile>;
  if (parsed.ids === undefined || typeof parsed.ids !== "object") {
    throw new UsageError(`${path} has no "ids" object`);
  }
  return parsed as SurveysFile;
}

async function main(argv: readonly string[]): Promise<number> {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const base = argument(args, "--base");
  const surveysPath = argument(args, "--surveys");
  const out = argument(args, "--out");
  if (base === undefined || surveysPath === undefined || out === undefined) {
    throw new UsageError("--base, --surveys and --out are required");
  }
  const url = new URL(base);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UsageError("--base must be an http or https URL");
  }
  const problems = await record({
    base: base.replace(/\/+$/, ""),
    surveys: readSurveys(surveysPath),
    out,
    only: argument(args, "--only"),
  });
  console.log(`${problems === 0 ? "All" : "Not all"} recorded answers match the derived goldens.`);
  return problems === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (error: unknown) => {
      if (!(error instanceof UsageError)) throw error;
      console.error(
        `${error.message}\nUsage: record --base <url> --surveys <file> --out <dir> [--only <action>[/<case>]]`,
      );
      process.exitCode = 2;
    },
  );
}
