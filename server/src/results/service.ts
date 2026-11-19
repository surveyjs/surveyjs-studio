import { randomUUID } from "node:crypto";
import type { components } from "@surveyjs-studio/contract";
import type { RequestUser } from "../auth/authenticate.js";
import type { Clock } from "../auth/session.js";
import { responseIdFor } from "../domain/response-id.js";
import { AppError } from "../errors.js";
import type { CompletionState, SurveyDefinition, SurveyRecord } from "../domain/types.js";
import { respondentIp } from "../ip.js";
import {
  ResponseTooLargeError,
  type ProjectStore,
  type ResponsePosition,
  type FileStore,
  type ResultStore,
  type SurveyStore,
  type ViewStore,
} from "../providers/types.js";
import { createSurveyAccess, notFound } from "../surveys/access.js";
import { availableSurvey, surveyNotAvailable } from "./availability.js";
import { decodeResultsCursor, encodeResultsCursor } from "../paging/cursor.js";
import { privateKeysOf, withoutKeys } from "./definition.js";
import { csvColumns } from "./csv.js";
import {
  EXPORT_PAGE_SIZE,
  csvExport,
  jsonExport,
  responseJson,
  storedResponses,
} from "./export.js";
import { summarizeQuestion } from "./question-summary.js";
import { exportFileName, type ExportFormat } from "./export-format.js";
import { limitCookieOf, publishedDefinition } from "./one-response.js";

export type PublishedSurveyJson = components["schemas"]["PublishedSurvey"];
export type ResultStatsJson = components["schemas"]["ResultStats"];
export type ResponsePageJson = components["schemas"]["ResponsePage"];
export type PublicResultPageJson = components["schemas"]["PublicResultPage"];
export type QuestionSummaryJson = components["schemas"]["QuestionSummary"];

export interface ExportFile {
  /** `exportFileName(survey.name, format)`. */
  readonly fileName: string;
  /** `application/json; charset=utf-8` or `text/csv; charset=utf-8`. */
  readonly contentType: string;
  /** The file, produced while it is sent. */
  readonly body: AsyncIterable<string>;
}

export interface SubmitRequest {
  readonly data: Record<string, unknown>;
  readonly clientId?: string;
  /** Save progress without completing; counts only with a `clientId`. */
  readonly partial?: boolean;
  /** The Idempotency-Key header, when sent. */
  readonly idempotencyKey?: string;
  /** request.ip (already resolved through TRUST_PROXY). */
  readonly ip: string;
}

export interface ResultsService {
  getPublished(surveyId: string, clientId: string | undefined): Promise<PublishedSurveyJson>;
  submit(surveyId: string, request: SubmitRequest): Promise<{ id: string }>;
  /**
   * As `submit`, addressed by post ID and following the old service's checks: the survey's publish
   * state and "Limit to one response" are ignored. Unknown post ID: `survey-not-available`.
   */
  submitByPostId(postId: string, request: SubmitRequest): Promise<{ id: string }>;
  /** The working definition, whatever the survey's publish state; `survey-not-available` when none. */
  getPublicDefinition(surveyId: string): Promise<{ content: SurveyDefinition; version: string }>;
  /** A client's state in the survey, by survey ID or result ID; `survey-not-available` when unknown. */
  respondentState(
    key: { readonly surveyId: string } | { readonly resultId: string },
    clientId: string,
  ): Promise<{ state: CompletionState }>;
  /** One question's answers counted over the completed responses; `survey-not-available` for an unknown result ID. */
  questionSummary(resultId: string, name: string): Promise<QuestionSummaryJson>;
  stats(user: RequestUser, surveyId: string): Promise<ResultStatsJson>;
  /** One page of every stored response, oldest first; answers included. */
  list(
    user: RequestUser,
    surveyId: string,
    page: { limit: number; cursor?: string },
  ): Promise<ResponsePageJson>;
  /** Every stored response as a file, by `format`, streamed. */
  exportResults(user: RequestUser, surveyId: string, format: ExportFormat): Promise<ExportFile>;
  /** Deletes every response, marker and respondent file; needs modify permission. */
  deleteResults(user: RequestUser, surveyId: string): Promise<void>;
  /** One page of public results (Grant Access on); private questions' answers left out. */
  publicPage(
    surveyId: string,
    page: { limit: number; cursor?: string },
  ): Promise<PublicResultPageJson>;
}

export interface ResultsServiceOptions {
  readonly surveys: SurveyStore;
  readonly projects: ProjectStore;
  readonly results: ResultStore;
  /** Respondent files: deleted with the results. */
  readonly files: FileStore;
  /** The private-question lists. */
  readonly views: ViewStore;
  /** The clock for submission times; default `Date.now`. */
  readonly now?: Clock;
}

const alreadyCompleted = (): AppError =>
  new AppError({
    code: "already-completed",
    status: 409,
    title: "Already completed",
    detail:
      "This survey accepts one response per respondent, and this one has already completed it.",
  });

const tooLarge = (cause: unknown): AppError =>
  new AppError({
    code: "payload-too-large",
    status: 413,
    title: "Payload too large",
    detail: "The answers are too large to store.",
    cause,
  });

/** Loading a published survey, storing responses to it once, and counting them. */
export function createResultsService(options: ResultsServiceOptions): ResultsService {
  const { surveys, projects, results, files, views, now = Date.now } = options;
  const access = createSurveyAccess({ surveys, projects });

  /** Stores a response to `survey`; `limitToOneResponse` off ignores the survey's one-response limit. */
  async function store(
    survey: SurveyRecord,
    request: SubmitRequest,
    check: { readonly limitToOneResponse: boolean },
  ): Promise<{ id: string }> {
    const { clientId, idempotencyKey } = request;
    const id =
      idempotencyKey === undefined ? randomUUID() : responseIdFor(survey.id, idempotencyKey);
    // A retry of a stored response answers as the original did, even if the client has completed since.
    if (idempotencyKey !== undefined && (await results.hasResponse(survey, id))) return { id };

    if (clientId !== undefined && check.limitToOneResponse) {
      const definition = await surveys.getDefinition(survey.id);
      if (!definition) throw surveyNotAvailable();
      const limited = survey.settings.useCookies || limitCookieOf(definition.content) !== null;
      if (limited && (await results.completion(survey, clientId)) === "completed") {
        throw alreadyCompleted();
      }
    }
    try {
      await results.appendResponse(survey, {
        id,
        submittedAt: new Date(now()).toISOString(),
        data: request.data,
        ...(clientId !== undefined && { clientId }),
        ...(clientId !== undefined && request.partial === true && { partial: true }),
        ...(survey.settings.storeRespondentIp && { respondentIp: respondentIp(request.ip) }),
      });
    } catch (error) {
      if (error instanceof ResponseTooLargeError) throw tooLarge(error);
      throw error;
    }
    return { id };
  }

  return {
    async getPublished(surveyId, clientId) {
      const survey = await availableSurvey(surveys, surveyId);
      const [definition, theme] = await Promise.all([
        surveys.getDefinition(survey.id),
        surveys.getTheme(survey.id),
      ]);
      // Deleted between the checks: the same answer as for an unknown survey.
      if (!definition || !theme) throw surveyNotAvailable();
      const completed =
        clientId === undefined
          ? undefined
          : (await results.completion(survey, clientId)) === "completed";
      return {
        id: survey.id,
        name: survey.name,
        definition: publishedDefinition(survey, definition.content),
        theme: theme.content,
        ...(completed !== undefined && { completed }),
      };
    },

    submit: async (surveyId, request) =>
      store(await availableSurvey(surveys, surveyId), request, { limitToOneResponse: true }),

    async submitByPostId(postId, request) {
      const survey = await surveys.findSurveyByKey({ postId });
      if (!survey) throw surveyNotAvailable();
      return store(survey, request, { limitToOneResponse: false });
    },

    async getPublicDefinition(surveyId) {
      const definition = await surveys.getDefinition(surveyId);
      if (!definition || !(await surveys.getSurvey(surveyId))) throw surveyNotAvailable();
      return definition;
    },

    async respondentState(key, clientId) {
      const survey =
        "surveyId" in key
          ? await surveys.getSurvey(key.surveyId)
          : await surveys.findSurveyByKey(key);
      if (!survey) throw surveyNotAvailable();
      return { state: await results.completion(survey, clientId) };
    },

    async questionSummary(resultId, name) {
      const survey = await surveys.findSurveyByKey({ resultId });
      if (!survey) throw surveyNotAvailable();
      const completed = async function* () {
        let after: ResponsePosition | undefined;
        for (;;) {
          const page = await results.listResponsePage(survey, {
            limit: EXPORT_PAGE_SIZE,
            completedOnly: true,
            ...(after && { after }),
          });
          yield* page.items;
          if (page.next === null) return;
          after = page.next;
        }
      };
      const [counts, stats] = await Promise.all([
        summarizeQuestion(name, completed()),
        results.stats(survey),
      ]);
      return {
        answered: counts.answered,
        values: counts.values,
        responseCount: stats.count,
        firstSubmittedAt: stats.firstSubmittedAt,
        lastSubmittedAt: stats.lastSubmittedAt,
      };
    },

    async stats(user, surveyId) {
      const { survey } = await access.visible(user, surveyId);
      return results.stats(survey);
    },

    async list(user, surveyId, page) {
      const { survey } = await access.visible(user, surveyId);
      const after =
        page.cursor === undefined ? undefined : decodeResultsCursor(page.cursor, survey.id);
      const { items, next } = await results.listResponsePage(survey, {
        limit: page.limit,
        ...(after && { after }),
      });
      return {
        items: items.map(responseJson),
        nextCursor: next ? encodeResultsCursor(next, survey.id) : null,
      };
    },

    async exportResults(user, surveyId, format) {
      const { survey } = await access.visible(user, surveyId);
      let columns: ReturnType<typeof csvColumns> | undefined;
      if (format === "csv") {
        const definition = await surveys.getDefinition(survey.id);
        if (!definition) throw notFound();
        columns = csvColumns(definition.content, {
          storeRespondentIp: survey.settings.storeRespondentIp,
          partial: await results.hasPartial(survey),
        });
      }
      const responses = await storedResponses(results, survey);
      return {
        fileName: exportFileName(survey.name, format),
        contentType:
          format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
        body: columns ? csvExport(columns, responses) : jsonExport(responses),
      };
    },

    async deleteResults(user, surveyId) {
      const { survey } = await access.modifiable(user, surveyId);
      await files.deleteSurveyFiles(survey.id, "response");
      await results.deleteAll(survey);
    },

    async publicPage(surveyId, page) {
      const survey = await surveys.getSurvey(surveyId);
      if (!survey?.settings.publicResults) throw surveyNotAvailable();
      const after =
        page.cursor === undefined ? undefined : decodeResultsCursor(page.cursor, survey.id);
      const [definition, privateQuestions] = await Promise.all([
        surveys.getDefinition(survey.id),
        views.getPrivateQuestions(survey.id),
      ]);
      if (!definition) throw surveyNotAvailable();
      const hidden = privateKeysOf(definition.content, privateQuestions);
      const { items, next } = await results.listResponsePage(survey, {
        limit: page.limit,
        completedOnly: true,
        ...(after && { after }),
      });
      return {
        survey: {
          id: survey.id,
          name: survey.name,
          definition: definition.content,
          privateQuestions: [...privateQuestions],
        },
        items: items.map((response) => ({
          submittedAt: response.submittedAt,
          data: withoutKeys(response.data, hidden),
        })),
        nextCursor: next ? encodeResultsCursor(next, survey.id) : null,
      };
    },
  };
}
