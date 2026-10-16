import { createFileRoute } from "@tanstack/react-router";
import { loadSurvey } from "../../../../surveyList/surveyLoader";

/** The survey history's place (`/surveys/$surveyId/history`); the edits list. */
export const Route = createFileRoute("/_private/surveys/$surveyId/history")({
  loader: ({ context: { queryClient }, params }) => loadSurvey(queryClient, params.surveyId),
});
