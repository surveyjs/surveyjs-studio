import { randomUUID } from "node:crypto";
import type { components } from "@my-surveys/contract";
import type { RequestUser } from "../auth/authenticate.js";
import type { Clock } from "../auth/session.js";
import { responseIdFor } from "../domain/response-id.js";
import { AppError } from "../errors.js";
import { respondentIp } from "../ip.js";
import {
  ResponseTooLargeError,
  type Directory,
  type ResultStore,
  type SurveyStore,
} from "../providers/types.js";
import { createSurveyAccess } from "../surveys/access.js";
import { availableSurvey, surveyNotAvailable } from "./availability.js";
import { limitCookieOf, publishedDefinition } from "./one-response.js";

export type PublishedSurveyJson = components["schemas"]["PublishedSurvey"];
export type ResultStatsJson = components["schemas"]["ResultStats"];

export interface SubmitRequest {
  readonly data: Record<string, unknown>;
  readonly clientId?: string;
  /** The Idempotency-Key header, when sent. */
  readonly idempotencyKey?: string;
  /** request.ip (already resolved through TRUST_PROXY). */
  readonly ip: string;
}

export interface ResultsService {
  getPublished(surveyId: string, clientId: string | undefined): Promise<PublishedSurveyJson>;
  submit(surveyId: string, request: SubmitRequest): Promise<{ id: string }>;
  stats(user: RequestUser, surveyId: string): Promise<ResultStatsJson>;
}

export interface ResultsServiceOptions {
  readonly surveys: SurveyStore;
  readonly directory: Directory;
  readonly results: ResultStore;
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
  const { surveys, directory, results, now = Date.now } = options;
  const access = createSurveyAccess({ surveys, directory });

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

    async submit(surveyId, request) {
      const survey = await availableSurvey(surveys, surveyId);
      const { clientId, idempotencyKey } = request;
      const id =
        idempotencyKey === undefined ? randomUUID() : responseIdFor(survey.id, idempotencyKey);
      // A retry of a stored response answers as the original did, even if the client has completed since.
      if (idempotencyKey !== undefined && (await results.hasResponse(survey, id))) return { id };

      if (clientId !== undefined) {
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
          ...(survey.settings.storeRespondentIp && { respondentIp: respondentIp(request.ip) }),
        });
      } catch (error) {
        if (error instanceof ResponseTooLargeError) throw tooLarge(error);
        throw error;
      }
      return { id };
    },

    async stats(user, surveyId) {
      const { survey } = await access.visible(user, surveyId);
      return results.stats(survey);
    },
  };
}
