// Records the real old API's answers to the golden requests, for review in the private location
// (ADR 0039 point 6; plan-hosted rule 6: production data never goes into the repository).
//
//   pnpm --filter @surveyjs-studio/legacy-compat-tests record -- \
//     --base https://api.surveyjs.io --surveys <file> --out <dir> [--key-file <file>] \
//     [--only <action>[/<case>]]
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
// `--key-file` names a file outside the repository holding the test account's access key. With it,
// the keyed cases (a request with `{{accessKey}}` or `{{revokedKey}}`) run, and only against
// surveys the script makes: a keyed case with a `setup` gets a survey made and set up through the
// old actions with the key, deleted after the case, and at the end every survey that appeared
// during the run is deleted (use a test account nobody else changes meanwhile); surveys a case
// makes (`creates`) are deleted right after it. A failed delete is printed with the survey's ID and
// fails the run, and the end lists the account again and names any survey of the run still there.
// Keyed cases that name a fixture ID, need a project member's key or a project, or carry
// `noRecording` are skipped.
// `{{revokedKey}}` is a made-up key the old API never had. Without the file, keyed cases are
// skipped. The key is never printed or written: recordings keep the golden request
// (`{{accessKey}}`), and the key is mapped back to its variable in answers and printed lines.
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
  FEEDBACK_DEFINITION,
  isKeyed,
  loadGoldens,
  sendRequest,
  SETUP_SURVEY_NAME,
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
  /** The test account's access key (from `--key-file`); without it keyed cases are skipped. */
  readonly key?: string;
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
 * The access key in `path`, a file outside the repository (it must never be committed), without
 * surrounding whitespace.
 */
export function readKeyFile(path: string): string {
  if (insideRepository(path)) {
    throw new UsageError("--key-file is inside the repository; keep the key outside it");
  }
  const key = readFileSync(path, "utf8").trim();
  if (key === "") throw new UsageError("--key-file is empty");
  return key;
}

/** What `{{revokedKey}}` is when recording: a key the old API never had. */
export const RETIRED_KEY = "retired-access-key-of-the-recordings";

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
  return sendRequest(base, request);
}

/** Posts and uploads the case's setup to `survey` through the public actions; adds their variables. */
async function postAndUpload(
  base: string,
  golden: Golden,
  survey: SurveyIds,
  vars: Record<string, string>,
): Promise<void> {
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
}

/** The variables naming a survey. */
function surveyVars(survey: SurveyIds): Record<string, string> {
  return {
    "survey.surveyId": survey.surveyId,
    "survey.postId": survey.postId,
    "survey.resultId": survey.resultId,
  };
}

// ---- The test account, through the old actions with its key ----

const PRIVATE = "/private/v1/Surveys/";

/** The fields of the old survey record the script reads. */
interface OldRecord {
  readonly Id: string;
  readonly PostId: string;
  readonly ResultId: string;
  readonly UserId: string;
}

/** The old action that saves each kind of shared layout. */
const LAYOUT_ACTIONS = {
  table: "setResultTableState",
  summary: "setResultSummaryState",
  columns: "setResultColumns",
} as const;

/** The test account's surveys, through the old actions with its key. */
class Account {
  private before: Set<string> | undefined;
  private knownUserId: string | undefined;
  /** The surveys whose delete failed while they still existed (or could not be checked). */
  readonly failedDeletes: string[] = [];
  /** How many times the account's surveys could not be listed to clean up after a case. */
  failedLists = 0;

  constructor(
    private readonly base: string,
    private readonly key: string,
    /** Prints a line (masked by the caller). */
    private readonly log: (line: string) => void,
  ) {}

  /** Calls an old private action with the key and a JSON body; throws unless it answers `200`. */
  private async action(
    method: string,
    action: string,
    query: Record<string, string> = {},
    body?: unknown,
  ): Promise<Buffer> {
    const answer = await call(this.base, {
      method,
      path: `${PRIVATE}${action}`,
      query: { ...query, accessKey: this.key },
      ...(body !== undefined && {
        headers: { "content-type": "application/json; charset=utf-8" },
        body: { json: body },
      }),
    });
    if (answer.status !== 200) {
      throw new CaseError(`the account's ${action} answered ${answer.status}`);
    }
    return answer.body;
  }

  /** An action whose answer is JSON. */
  private async json<T>(method: string, action: string, query?: Record<string, string>) {
    const body = await this.action(method, action, query);
    try {
      return JSON.parse(body.toString("utf8")) as T;
    } catch {
      throw new CaseError(`the account's ${action} answered no JSON`);
    }
  }

  /** The IDs of every survey of the account, active and archived. */
  async surveyIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const action of ["getActive", "getArchive"]) {
      const list = await this.json<OldRecord[]>("GET", action);
      if (!Array.isArray(list)) throw new CaseError(`the account's ${action} answered no list`);
      for (const survey of list) ids.add(String(survey.Id).toLowerCase());
    }
    return ids;
  }

  /** Remembers the account's surveys, so that `sweep` removes only the run's own. */
  async start(): Promise<void> {
    this.before ??= await this.surveyIds();
  }

  /** The account's user ID, from a survey made for it and deleted. */
  async userId(): Promise<string> {
    if (this.knownUserId === undefined) {
      const probe = await this.json<OldRecord>("POST", "create", {
        name: `${SETUP_SURVEY_NAME} probe`,
      });
      await this.remove(probe.Id);
      this.knownUserId = probe.UserId;
    }
    return this.knownUserId;
  }

  /**
   * A survey made and set up as the case's setup says, through the old actions; its variables
   * hold its IDs, `owner.userId` and, after posts, `survey.responseId`.
   */
  async survey(golden: Golden): Promise<{ surveyId: string; vars: Record<string, string> }> {
    const setup = golden.setup!;
    const created = await this.json<OldRecord>("POST", "create", { name: SETUP_SURVEY_NAME });
    this.knownUserId ??= created.UserId;
    const ids = { surveyId: created.Id, postId: created.PostId, resultId: created.ResultId };
    const vars: Record<string, string> = { ...surveyVars(ids), "owner.userId": created.UserId };
    try {
      const { settings = {}, theme, layouts = {}, archived } = setup.survey;
      const id = { id: ids.surveyId };
      await this.action(
        "PUT",
        "changeJson",
        {},
        {
          Id: ids.surveyId,
          Json: JSON.stringify(FEEDBACK_DEFINITION),
        },
      );
      for (const [name, value] of Object.entries(settings)) {
        if (name === "publicResults") {
          await this.action("PUT", "makeResultPublic", { ...id, makeResultPublic: `${value}` });
        } else if (name === "storeRespondentIp") {
          await this.action("PUT", "storeIPAddressInResult", { ...id, storeIPAddress: `${value}` });
        } else if (name === "useCookies") {
          await this.action("PUT", "setUseCookies", { ...id, useCookies: `${value}` });
        } else if (name === "privateResultQuestions") {
          const permissions = (value as string[]).map((question) => ({
            name: question,
            isPublic: false,
          }));
          await this.action(
            "PUT",
            "setResultPermissions",
            {},
            {
              Id: ids.surveyId,
              Json: JSON.stringify(permissions),
            },
          );
        } else {
          throw new CaseError(`the setting ${name} has no old action`);
        }
      }
      if (theme !== undefined) {
        await this.action(
          "PUT",
          "changeTheme",
          {},
          {
            Id: ids.surveyId,
            ThemeJson: JSON.stringify(theme),
          },
        );
      }
      for (const [kind, text] of Object.entries(layouts)) {
        const action = LAYOUT_ACTIONS[kind as keyof typeof LAYOUT_ACTIONS];
        await this.action("PUT", action, {}, { Id: ids.surveyId, Json: text });
      }
      await postAndUpload(this.base, golden, ids, vars);
      if ((setup.posts ?? []).length > 0) {
        const results = await this.json<{ Data?: { InstanceId?: unknown }[] }>(
          "GET",
          "getSurveyResults",
          id,
        );
        const first = results.Data?.[0]?.InstanceId;
        if (typeof first === "string") vars["survey.responseId"] = first;
      }
      if (archived === true) await this.action("PUT", "archive", id);
    } catch (error) {
      await this.remove(ids.surveyId);
      throw error;
    }
    return { surveyId: ids.surveyId, vars };
  }

  /**
   * Deletes a survey of the run; one already gone (a case deleted it) is fine. Never throws, so a
   * cleanup cannot hide the outcome of the case it follows: a delete that fails while the survey
   * is still listed, or whose survey cannot be listed again, is printed with the survey's ID
   * (only the script's own words) and remembered, so the run ends with a failure.
   */
  async remove(surveyId: string): Promise<void> {
    let status: number;
    try {
      status = (
        await call(this.base, {
          method: "DELETE",
          path: `${PRIVATE}delete`,
          query: { id: surveyId, accessKey: this.key },
        })
      ).status;
    } catch {
      this.failedDeletes.push(surveyId);
      this.log(`Could not delete survey ${surveyId}: the delete request failed.`);
      return;
    }
    if (status === 200) return;
    try {
      if (!(await this.surveyIds()).has(surveyId.toLowerCase())) return;
    } catch {
      this.failedDeletes.push(surveyId);
      this.log(
        `Could not delete survey ${surveyId}: delete answered ${status}, ` +
          "and the account's surveys could not be listed.",
      );
      return;
    }
    this.failedDeletes.push(surveyId);
    this.log(`Could not delete survey ${surveyId}: delete answered ${status}.`);
  }

  /**
   * Deletes every survey listed now that `before` does not hold. Never throws: a list that fails
   * is printed and remembered, and the run's sweep tries again.
   */
  async removeNew(before: ReadonlySet<string>): Promise<void> {
    let listed: Set<string>;
    try {
      listed = await this.surveyIds();
    } catch {
      this.failedLists += 1;
      this.log("Could not list the test account's surveys to clean up after a case.");
      return;
    }
    for (const id of listed) if (!before.has(id)) await this.remove(id);
  }

  /**
   * Deletes every survey that appeared since `start`, then lists the account again: the IDs of
   * the run's surveys still there (none when the cleanup worked). Throws when the account cannot
   * be listed; the run reports that once.
   */
  async sweep(): Promise<string[]> {
    if (this.before === undefined) return [];
    const before = this.before;
    for (const id of await this.surveyIds()) if (!before.has(id)) await this.remove(id);
    return [...(await this.surveyIds())].filter((id) => !before.has(id));
  }
}

/** Why a keyed case is not replayed; `undefined` when it is. */
function keyedSkip(golden: Golden, account: Account | undefined): string | undefined {
  const request = JSON.stringify(golden.request);
  if (account === undefined) return "a keyed request needs --key-file";
  if (request.includes("{{memberKey}}")) return "needs a project member's key";
  if (golden.setup?.survey.projectId !== undefined) return "needs a project of the test account";
  if (request.match(FIXTURE_ID) !== null) {
    return "keyed requests run only on surveys the script makes";
  }
  return undefined;
}

/** Records one case into `out` (already resolved); returns the line to print. */
async function recordCase(
  options: RecordOptions,
  out: string,
  account: Account | undefined,
  { name, golden }: GoldenCase,
): Promise<string> {
  const { base, surveys } = options;
  if (golden.noRecording !== undefined) return `${name}: skipped (${golden.noRecording})`;
  const keyed = isKeyed(golden.request);
  if (keyed) {
    const why = keyedSkip(golden, account);
    if (why !== undefined) return `${name}: skipped (${why})`;
  } else {
    const missing = unmappedIds(golden.request, surveys.ids);
    if (missing.length > 0) {
      return `${name}: skipped (no test-account value for ${missing.join(", ")})`;
    }
  }
  // A keyed case always gets a survey the script makes; another case the one the surveys file
  // gives it, else (with a key) one the script makes, else the file's shared survey.
  const given = keyed ? undefined : (surveys.cases?.[name] ?? undefined);
  const own = golden.setup !== undefined && given === undefined && account !== undefined;
  const shared = golden.setup !== undefined && given === undefined && !own ? surveys.survey : given;
  if (golden.setup !== undefined && !own && shared === undefined) {
    return `${name}: skipped (needs "survey" or cases["${name}"] in the surveys file)`;
  }
  const toAccount = Object.entries(surveys.ids);
  const vars: Record<string, string> = {};
  if (account !== undefined) {
    vars.accessKey = options.key!;
    vars.revokedKey = RETIRED_KEY;
  }
  let made: string | undefined;
  // A case that makes surveys (create, clone) has them deleted right after it, so later list
  // recordings see the account as it was.
  let beforeCase: Set<string> | undefined;
  if (own) {
    const survey = await account!.survey(golden);
    made = survey.surveyId;
    Object.assign(vars, survey.vars);
  } else if (shared !== undefined) {
    Object.assign(vars, surveyVars(shared));
    await postAndUpload(base, golden, shared, vars);
  }
  try {
    if (account !== undefined && vars["owner.userId"] === undefined) {
      if (JSON.stringify(golden).includes("{{owner.userId}}")) {
        vars["owner.userId"] = await account.userId();
      }
    }
    if (golden.creates === true && account !== undefined) beforeCase = await account.surveyIds();
    // A keyed request names no fixture ID, so it is sent as written.
    const written = keyed ? golden.request : mapValues(golden.request, toAccount);
    const answer = await call(base, substitute(written, vars));

    const expected = substitute(mapValues(golden.response, toAccount), vars);
    const differences = compareAnswer(expected, answer);

    // Back to the fixtures' values, so the recording can stand in for the derived file; the keys
    // back to their variables.
    const toFixtures: [string, string][] = [
      ...Object.entries(vars).map(([key, value]): [string, string] => [value, `{{${key}}}`]),
      ...toAccount.map(([fixture, value]): [string, string] => [value, fixture]),
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
      ...(golden.creates !== undefined && { creates: golden.creates }),
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
  } finally {
    // Neither throws: a failed cleanup is printed and counted, and the case's own line or error
    // stays what the run reports for it.
    if (beforeCase !== undefined) await account!.removeNew(beforeCase);
    if (made !== undefined) await account!.remove(made);
  }
}

/** Records every selected case into `options.out`; returns how many differ or failed. */
export async function record(options: RecordOptions): Promise<number> {
  const out = realPath(options.out);
  if (insideRepository(out)) {
    throw new UsageError(
      "--out is inside the repository; recordings go to the private location (plan-hosted rule 6)",
    );
  }
  const key = options.key;
  const print = options.log ?? ((line: string) => console.log(line));
  // Whatever a line quotes, the key never reaches the output.
  const log = (line: string) =>
    print(key === undefined ? line : line.replaceAll(key, "{{accessKey}}"));
  const cases = loadGoldens().filter(
    ({ name }) =>
      options.only === undefined || name === options.only || name.startsWith(`${options.only}/`),
  );
  const account = key === undefined ? undefined : new Account(options.base, key, log);
  let problems = 0;
  try {
    if (account !== undefined && cases.some(({ golden }) => isKeyed(golden.request))) {
      try {
        await account.start();
      } catch (error) {
        throw new UsageError(
          `the test account's surveys could not be listed${
            error instanceof CaseError ? ` (${error.message})` : ""
          }`,
        );
      }
    }
    for (const goldenCase of cases) {
      try {
        const line = await recordCase(options, out, account, goldenCase);
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
  } finally {
    if (account !== undefined) {
      try {
        const left = await account.sweep();
        if (left.length === 0) {
          log("The run left no survey of its own behind.");
        } else {
          problems += 1;
          log(`The run left ${left.length} survey(s) of its own behind: ${left.join(", ")}.`);
        }
      } catch {
        problems += 1;
        log("Could not list the test account's surveys after the run: check it.");
      }
      // Each failed delete or cleanup list fails the run, even when the sweep removed the survey
      // later.
      problems += account.failedDeletes.length + account.failedLists;
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
  const keyFile = argument(args, "--key-file");
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
    ...(keyFile !== undefined && { key: readKeyFile(keyFile) }),
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
        `${error.message}\nUsage: record --base <url> --surveys <file> --out <dir> [--key-file <file>] [--only <action>[/<case>]]`,
      );
      process.exitCode = 2;
    },
  );
}
