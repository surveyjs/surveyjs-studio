import type { QueryClient } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import { ApiError } from "../api/client";
import { surveyQueryOptions } from "../api/surveys";

/** The loader of the survey placeholder routes: loads the survey, `notFound` when it is not there. */
export async function loadSurvey(queryClient: QueryClient, surveyId: string): Promise<void> {
  try {
    await queryClient.ensureQueryData(surveyQueryOptions(surveyId));
  } catch (error) {
    // 404: unknown or not visible to the user; 400: not a survey id at all.
    if (error instanceof ApiError && [400, 404].includes(error.problem.status)) throw notFound();
    throw error;
  }
}
