import { createFileRoute } from "@tanstack/react-router";
import { loadSurvey } from "../../../../surveyList/surveyLoader";

/** The survey results' place (`/surveys/$surveyId/results`); a placeholder until Step 9. */
export const Route = createFileRoute("/_private/surveys/$surveyId/results")({
  loader: ({ context: { queryClient }, params }) => loadSurvey(queryClient, params.surveyId),
});
