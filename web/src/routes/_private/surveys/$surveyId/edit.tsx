import { createFileRoute } from "@tanstack/react-router";
import { loadSurvey } from "../../../../surveyList/surveyLoader";

/**
 * The survey editor (`/surveys/$surveyId/edit`). The loader reads the survey record (its rights
 * make the editor read-only); the page reads the definition and the theme itself, fresh on every
 * open.
 */
export const Route = createFileRoute("/_private/surveys/$surveyId/edit")({
  loader: ({ context: { queryClient }, params }) => loadSurvey(queryClient, params.surveyId),
});
