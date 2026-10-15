import { createFileRoute } from "@tanstack/react-router";
import { loadSurvey } from "../../../../surveyList/surveyLoader";

/** The survey editor's place (`/surveys/$surveyId/edit`); a placeholder until Step 6. */
export const Route = createFileRoute("/_private/surveys/$surveyId/edit")({
  loader: ({ context: { queryClient }, params }) => loadSurvey(queryClient, params.surveyId),
});
