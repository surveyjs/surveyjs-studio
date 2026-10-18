import type { components } from "@my-surveys/contract";
import type { Handlers } from "../api.js";
import { requireUser } from "../auth/authenticate.js";
import {
  createSurveysService,
  type SurveyListQuery,
  type SurveysServiceOptions,
} from "./service.js";

type SurveyCreate = components["schemas"]["SurveyCreate"];
type SurveyPatch = components["schemas"]["SurveyPatch"];
type SurveyClone = { name?: string; projectId?: string | null };

/** The survey operations: list, create, get, update, delete and clone. Requests reach them validated by the contract. */
export function createSurveyHandlers(options: SurveysServiceOptions): Handlers {
  const service = createSurveysService(options);

  return {
    listSurveys: (request) => service.list(requireUser(request), request.query as SurveyListQuery),

    createSurvey: async (request, reply) => {
      const survey = await service.create(
        requireUser(request),
        request.body as SurveyCreate | undefined,
      );
      return reply.code(201).header("location", `/api/v1/surveys/${survey.id}`).send(survey);
    },

    getSurvey: (request) => {
      const { surveyId } = request.params as { surveyId: string };
      return service.get(requireUser(request), surveyId, request.log);
    },

    updateSurvey: (request) => {
      const { surveyId } = request.params as { surveyId: string };
      return service.update(
        requireUser(request),
        surveyId,
        request.body as SurveyPatch,
        request.log,
      );
    },

    deleteSurvey: async (request, reply) => {
      const { surveyId } = request.params as { surveyId: string };
      await service.delete(requireUser(request), surveyId);
      return reply.code(204).send();
    },

    cloneSurvey: async (request, reply) => {
      const { surveyId } = request.params as { surveyId: string };
      const copy = await service.clone(
        requireUser(request),
        surveyId,
        request.body as SurveyClone | undefined,
      );
      return reply.code(201).header("location", `/api/v1/surveys/${copy.id}`).send(copy);
    },
  };
}
