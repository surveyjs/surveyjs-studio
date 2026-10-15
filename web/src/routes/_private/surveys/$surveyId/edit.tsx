import { createFileRoute, notFound } from "@tanstack/react-router";
import { ApiError } from "../../../../api/client";
import { surveyQueryOptions } from "../../../../api/surveys";

/** The survey editor's place (`/surveys/$surveyId/edit`); a stub until Step 6. */
export const Route = createFileRoute("/_private/surveys/$surveyId/edit")({
  loader: async ({ context: { queryClient }, params }) => {
    try {
      await queryClient.ensureQueryData(surveyQueryOptions(params.surveyId));
    } catch (error) {
      // 404: unknown or not visible to the user; 400: not a survey id at all.
      if (error instanceof ApiError && [400, 404].includes(error.problem.status)) throw notFound();
      throw error;
    }
  },
});
