import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { RequestUser } from "../auth/authenticate.js";
import { safeErrorText } from "../cli/common.js";
import { createContentService } from "../content/service.js";
import { formatEtag } from "../content/etag.js";
import type { SurveyDefinition, SurveyTheme } from "../domain/types.js";
import { AppError } from "../errors.js";
import { createProjectsService } from "../projects/service.js";
import type { ProviderSet } from "../providers/types.js";
import { createResultsService } from "../results/service.js";
import { createSurveysService, type WarningLog } from "../surveys/service.js";
import { LegacyApiError, type LegacyClient, type LegacySurvey } from "./legacy-client.js";

/**
 * The steps of `pnpm smoke:legacy` (Step 14 D7): each one writes through the app's service layer,
 * as the HTTP handlers do, and then reads the same data back through `api.surveyjs.io`. Only the
 * survey and the project the run creates are written; both are deleted at the end, also after a
 * failure.
 */

/** `pass`; `FAIL`: the legacy read disagrees or fails; `error`: the app write failed (the run stops). */
export type StepOutcome = "pass" | "FAIL" | "error" | "manual" | "skipped";

export interface StepResult {
  readonly step: string;
  /** What the app wrote. */
  readonly app: string;
  /** What was read through the legacy API. */
  readonly legacy: string;
  readonly result: StepOutcome;
  /** Why a step did not pass; free of secrets. */
  readonly detail?: string;
}

/** The test data a run creates. */
export type TestData = "survey" | "project";

export interface CleanupResult {
  readonly what: TestData;
  readonly id: string;
  /** true when it could not be deleted: the operator removes it by hand. */
  readonly failed: boolean;
  readonly text: string;
}

export interface SmokeRun {
  readonly steps: readonly StepResult[];
  /** One entry per cleanup action. */
  readonly cleanup: readonly CleanupResult[];
  /** Ids only (the service warnings). */
  readonly warnings: readonly string[];
  /** The signal stopped the run before its last step. */
  readonly interrupted: boolean;
}

export interface SmokeOptions {
  readonly providers: ProviderSet;
  /** The test account (found by email; not blocked). */
  readonly user: RequestUser;
  readonly legacy: LegacyClient;
  /** Default `Date.now`. */
  readonly now?: () => number;
  /**
   * An interrupt: once aborted, the steps not yet started are skipped and the cleanup runs. The
   * step under way finishes first.
   */
  readonly signal?: AbortSignal;
  /** Called as soon as the test survey or project exists. */
  readonly onCreated?: (what: TestData, id: string) => void;
  /** Called once it is deleted (by its step or by the cleanup). */
  readonly onRemoved?: (what: TestData, id: string) => void;
}

/** The detail of a failed `create survey` check when the new survey is not the account's. */
export const KEY_OF_ANOTHER_ACCOUNT =
  "the access key does not belong to this account (getActive does not list the new survey as the account's)";

/** The question the response answers; `getResult` counts its answers. */
const QUESTION = "smoke";
const ANSWER = "yes";

const DEFINITION: SurveyDefinition = {
  title: "Smoke test",
  pages: [
    {
      name: "page1",
      elements: [{ type: "radiogroup", name: QUESTION, choices: ["yes", "no"] }],
    },
  ],
};

const THEME: SurveyTheme = {
  themeName: "default",
  colorPalette: "light",
  isPanelless: false,
  cssVariables: { "--sjs-primary-backcolor": "#19b394" },
};

/** Text of an error that may be printed: never a secret, a URL or a legacy answer. */
export function describeFailure(error: unknown): string {
  if (error instanceof LegacyApiError) return error.message;
  if (error instanceof AppError) return `${error.code} (HTTP ${error.status})`;
  return safeErrorText(error);
}

const sameId = (a: unknown, b: string): boolean =>
  typeof a === "string" && a.toLowerCase() === b.toLowerCase();

const show = (value: unknown): string => JSON.stringify(value) ?? "undefined";

/** null when equal, else what differs. */
function compare(label: string, actual: unknown, expected: unknown): string | null {
  return isDeepStrictEqual(actual, expected)
    ? null
    : `${label} is ${show(actual)}, expected ${show(expected)}`;
}

/** The first of the messages that is not null. */
const firstProblem = (...problems: (string | null)[]): string | null =>
  problems.find((p) => p !== null) ?? null;

/** A step: the app write (its failure stops the run) and the legacy check (null when it passes). */
interface Step {
  readonly name: string;
  readonly app: string;
  readonly legacy: string;
  readonly write?: () => Promise<void>;
  readonly check?: () => Promise<string | null>;
  /** Not checked by the run: see the manual checklist. */
  readonly manual?: string;
  /** A failed check stops the run (the later steps are skipped). */
  readonly fatal?: boolean;
}

export async function runSmoke(options: SmokeOptions): Promise<SmokeRun> {
  const { providers, user, legacy, signal } = options;
  const created = (what: TestData, id: string): void => options.onCreated?.(what, id);
  const removed = (what: TestData, id: string): void => options.onRemoved?.(what, id);
  const now = options.now ?? Date.now;
  const warnings: string[] = [];
  const log: WarningLog = {
    warn: (details, message) => warnings.push(`${message} ${JSON.stringify(details)}`),
  };
  const deps = {
    surveys: providers.surveys,
    projects: providers.projects,
    files: providers.files,
    views: providers.views,
    users: providers.users,
    results: providers.results,
    now,
  };
  const surveys = createSurveysService(deps);
  const content = createContentService(deps);
  const results = createResultsService(deps);
  const projects = createProjectsService(deps);

  const stamp = new Date(now()).toISOString();
  const name = `Smoke test ${stamp}`;
  const renamed = `${name} (renamed)`;
  const clientId = `smoke-${randomUUID()}`;
  const state = {
    surveyId: "",
    postId: "",
    resultId: "",
    projectId: "",
    responseId: "",
    appPublished: false,
    surveyDeleted: false,
    projectDeleted: false,
  };

  /** The survey in the account's personal list (`ownerId` absent) or in a project's list. */
  async function listed(ownerId?: string): Promise<LegacySurvey | undefined> {
    const list = await legacy.listActive(ownerId);
    return list.find((s) => sameId(s.Id, state.surveyId));
  }

  async function listedProblem(
    where: string,
    ownerId: string | undefined,
    test: (s: LegacySurvey) => string | null,
  ): Promise<string | null> {
    const survey = await listed(ownerId);
    return survey === undefined ? `getActive (${where}) does not list the survey` : test(survey);
  }

  const update = async (patch: Parameters<typeof surveys.update>[2]): Promise<void> => {
    await surveys.update(user, state.surveyId, patch, log);
  };

  const steps: Step[] = [
    {
      name: "create survey",
      app: "create in Personal (published flag empty)",
      legacy: "getActive: Name, UserId, IsPublished null",
      write: async () => {
        const survey = await surveys.create(user, { name });
        state.surveyId = survey.id;
        created("survey", survey.id);
        state.postId = survey.postId;
        state.resultId = survey.resultId;
        state.appPublished = survey.published;
      },
      // Fatal: with a key of another account the later reads would check that account's view.
      fatal: true,
      check: async () => {
        const survey = await listed();
        if (survey === undefined || !sameId(survey.UserId, user.id)) return KEY_OF_ANOTHER_ACCOUNT;
        return firstProblem(
          compare("app published", state.appPublished, true),
          compare("Name", survey.Name, name),
          compare("IsPublished", survey.IsPublished, null),
        );
      },
    },
    {
      name: "rename",
      app: "update name",
      legacy: "getActive: Name",
      write: () => update({ name: renamed }),
      check: () => listedProblem("Personal", undefined, (s) => compare("Name", s.Name, renamed)),
    },
    {
      name: "save definition",
      app: "save definition",
      legacy: "getSurvey: the definition",
      write: async () => {
        const current = await content.getDefinition(user, state.surveyId);
        await content.saveDefinition(user, state.surveyId, DEFINITION, formatEtag(current.version));
      },
      check: async () => compare("getSurvey", await legacy.getSurvey(state.surveyId), DEFINITION),
    },
    {
      name: "history point",
      app: "the save's history point",
      legacy: "getHistoryPoint: the definition",
      check: async () => {
        const page = await providers.surveys.listHistory({ surveyId: state.surveyId, limit: 20 });
        let pointId: string | undefined;
        for (const entry of page.items) {
          const snapshot = await providers.surveys.getHistorySnapshot(state.surveyId, entry.id);
          if (isDeepStrictEqual(snapshot, DEFINITION)) {
            pointId = entry.id;
            break;
          }
        }
        if (pointId === undefined) return "the app lists no history point with the definition";
        return compare(
          "getHistoryPoint",
          await legacy.getHistoryPoint(state.surveyId, pointId),
          DEFINITION,
        );
      },
    },
    {
      name: "save theme",
      app: "save theme",
      legacy: "getActive: Theme",
      write: async () => {
        const current = await content.getTheme(user, state.surveyId);
        await content.saveTheme(user, state.surveyId, THEME, formatEtag(current.version));
      },
      check: () =>
        listedProblem("Personal", undefined, (s) => {
          let theme: unknown;
          try {
            theme = s.Theme === null ? null : (JSON.parse(s.Theme) as unknown);
          } catch {
            return "Theme is not JSON";
          }
          return compare("Theme", theme, THEME);
        }),
    },
    {
      name: "submit response",
      app: "public submit (flag still empty)",
      legacy: "getSurveyResults, getResult, isCompleted",
      write: async () => {
        const submitted = await results.submit(state.surveyId, {
          data: { [QUESTION]: ANSWER },
          clientId,
          ip: "127.0.0.1",
        });
        state.responseId = submitted.id;
      },
      check: async () => {
        const all = await legacy.getSurveyResults(state.surveyId);
        const row = all.Data[0];
        const rows = compare("getSurveyResults row count", all.Data.length, 1);
        if (rows !== null || row === undefined) return rows;
        const counts = await legacy.getResult(state.resultId, QUESTION);
        return firstProblem(
          compare(`getSurveyResults ${QUESTION}`, row[QUESTION], ANSWER),
          sameId(row.InstanceId, state.responseId)
            ? null
            : `getSurveyResults InstanceId is ${show(row.InstanceId)}, expected ${state.responseId}`,
          compare("getSurveyResults ClientId", row.ClientId, clientId),
          compare("getResult QuestionResult", counts.QuestionResult, { [ANSWER]: 1 }),
          compare("getResult AnswersCount", counts.AnswersCount, 1),
          compare("isCompleted", await legacy.isCompleted(state.resultId, clientId), "completed"),
        );
      },
    },
    {
      name: "public results",
      app: "settings: Grant Access on",
      legacy: "getActive: AllowAccessResult; getSurveyPublicResults",
      write: () => update({ settings: { publicResults: true } }),
      check: async () => {
        const flag = await listedProblem("Personal", undefined, (s) =>
          compare("AllowAccessResult", s.AllowAccessResult, true),
        );
        if (flag !== null) return flag;
        const open = await legacy.getSurveyPublicResults(state.surveyId);
        return firstProblem(
          compare("getSurveyPublicResults row count", open.Data.length, 1),
          compare(`getSurveyPublicResults ${QUESTION}`, open.Data[0]?.[QUESTION], ANSWER),
        );
      },
    },
    {
      name: "publish",
      app: "publish (flag 1)",
      legacy: "getActive: IsPublished true; getSurvey",
      write: () => update({ published: true }),
      check: async () =>
        firstProblem(
          await listedProblem("Personal", undefined, (s) =>
            compare("IsPublished", s.IsPublished, true),
          ),
          compare("getSurvey", await legacy.getSurvey(state.surveyId), DEFINITION),
        ),
    },
    {
      name: "unpublish",
      app: "unpublish (flag 0)",
      legacy: "getActive: IsPublished false",
      write: () => update({ published: false }),
      check: () =>
        listedProblem("Personal", undefined, (s) => compare("IsPublished", s.IsPublished, false)),
    },
    {
      name: "create project",
      app: "create project (account is admin)",
      legacy: "getActive?ownerId=project: empty",
      write: async () => {
        state.projectId = (await projects.create(user, { name })).id;
        created("project", state.projectId);
      },
      // A member gets the project's list (empty); a non-member would get the Personal list.
      check: async () => {
        const list = await legacy.listActive(state.projectId);
        return list.length === 0
          ? null
          : `getActive (project) lists ${list.length} surveys: the account is not read as a member`;
      },
    },
    {
      name: "move into project",
      app: "update projectId",
      legacy: "getActive: in the project, not in Personal",
      write: () => update({ projectId: state.projectId }),
      check: async () =>
        firstProblem(
          await listedProblem("project", state.projectId, (s) =>
            sameId(s.UserId, state.projectId)
              ? null
              : `UserId is ${show(s.UserId)}, expected the project`,
          ),
          (await listed()) === undefined ? null : "getActive (Personal) still lists the survey",
        ),
    },
    {
      name: "move to Personal",
      app: "update projectId null",
      legacy: "getActive: in Personal, not in the project",
      write: () => update({ projectId: null }),
      check: async () =>
        firstProblem(
          await listedProblem("Personal", undefined, (s) =>
            sameId(s.UserId, user.id) ? null : `UserId is ${show(s.UserId)}, expected the account`,
          ),
          (await listed(state.projectId)) === undefined
            ? null
            : "getActive (project) still lists the survey",
        ),
    },
    {
      name: "delete survey",
      app: "archive, then delete",
      legacy: "getSurvey: 400; getActive: not listed",
      write: async () => {
        await update({ archived: true });
        await surveys.delete(user, state.surveyId);
        state.surveyDeleted = true;
        removed("survey", state.surveyId);
      },
      check: async () =>
        firstProblem(
          compare("getSurvey", await legacy.getSurvey(state.surveyId), null),
          (await listed()) === undefined ? null : "getActive (Personal) still lists the survey",
        ),
    },
    {
      name: "delete project",
      app: "delete project",
      legacy: "none: api.surveyjs.io has no project read",
      write: async () => {
        await projects.delete(user, state.projectId);
        state.projectDeleted = true;
        removed("project", state.projectId);
      },
      manual: "checklist: the project is gone on surveyjs.io",
    },
  ];

  const done: StepResult[] = [];
  const cleanup: CleanupResult[] = [];
  let interrupted = false;
  try {
    let stopped = false;
    for (const step of steps) {
      const row = { step: step.name, app: step.app, legacy: step.legacy };
      if (!stopped && signal?.aborted) {
        interrupted = true;
        stopped = true;
      }
      if (stopped) {
        done.push({ ...row, result: "skipped" });
        continue;
      }
      try {
        await step.write?.();
      } catch (error) {
        done.push({ ...row, result: "error", detail: `app: ${describeFailure(error)}` });
        stopped = true;
        continue;
      }
      if (step.manual !== undefined) {
        done.push({ ...row, result: "manual", detail: step.manual });
        continue;
      }
      let problem: string | null;
      try {
        problem = (await step.check?.()) ?? null;
      } catch (error) {
        problem = describeFailure(error);
      }
      if (problem === null) {
        done.push({ ...row, result: "pass" });
      } else if (step.fatal) {
        done.push({ ...row, result: "FAIL", detail: `${problem}. The run stopped.` });
        stopped = true;
      } else {
        done.push({ ...row, result: "FAIL", detail: problem });
      }
    }
  } finally {
    // Also after a failure or a thrown error: the survey first (deleting a project moves its surveys).
    if (state.surveyId !== "" && !state.surveyDeleted) {
      try {
        const current = await providers.surveys.getSurvey(state.surveyId);
        if (current !== null) {
          if (!current.archived) await update({ archived: true });
          await surveys.delete(user, state.surveyId);
        }
        removed("survey", state.surveyId);
        cleanup.push({
          what: "survey",
          id: state.surveyId,
          failed: false,
          text: `deleted the test survey ${state.surveyId}`,
        });
      } catch (error) {
        cleanup.push({
          what: "survey",
          id: state.surveyId,
          failed: true,
          text: `could not delete the test survey ${state.surveyId}: ${describeFailure(error)}`,
        });
      }
    }
    if (state.projectId !== "" && !state.projectDeleted) {
      try {
        await projects.delete(user, state.projectId);
        removed("project", state.projectId);
        cleanup.push({
          what: "project",
          id: state.projectId,
          failed: false,
          text: `deleted the test project ${state.projectId}`,
        });
      } catch (error) {
        cleanup.push({
          what: "project",
          id: state.projectId,
          failed: true,
          text: `could not delete the test project ${state.projectId}: ${describeFailure(error)}`,
        });
      }
    }
  }
  return { steps: done, cleanup, warnings, interrupted };
}

/**
 * `ACTION NEEDED: remove survey <id> / project <id> as the test account` for what the cleanup could
 * not delete; null when it deleted everything.
 */
export function actionNeeded(cleanup: readonly CleanupResult[]): string | null {
  const left = cleanup.filter((c) => c.failed).map((c) => `${c.what} ${c.id}`);
  return left.length === 0 ? null : `ACTION NEEDED: remove ${left.join(" / ")} as the test account`;
}

/** Whether the run passed: every step `pass` or `manual`, and the cleanup succeeded. */
export function smokePassed(run: SmokeRun): boolean {
  return (
    run.steps.every((s) => s.result === "pass" || s.result === "manual") &&
    run.cleanup.every((c) => !c.failed)
  );
}

/** The `step | app | legacy | result` table, then one line per step that did not pass. */
export function formatTable(steps: readonly StepResult[]): string {
  const header = ["step", "app", "legacy", "result"];
  const rows = steps.map((s) => [s.step, s.app, s.legacy, s.result]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: readonly string[]): string =>
    `| ${cells.map((c, i) => c.padEnd(widths[i]!)).join(" | ")} |`;
  const lines = [
    line(header),
    `|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`,
    ...rows.map(line),
  ];
  const details = steps.filter((s) => s.detail !== undefined).map((s) => `${s.step}: ${s.detail}`);
  return [...lines, ...(details.length > 0 ? ["", ...details] : [])].join("\n") + "\n";
}
