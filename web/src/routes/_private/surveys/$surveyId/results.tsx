import { createFileRoute } from "@tanstack/react-router";
import { validateResultsSearch } from "../../../../results/search";
import { loadSurvey } from "../../../../surveyList/surveyLoader";

/**
 * The survey results (`/surveys/$surveyId/results?tab=summary|table|details`). The loader reads
 * only the survey record: the page reads the responses, the definition and the saved layouts
 * itself, so hovering a "View Results" link (a preload) fetches none of them.
 */
export const Route = createFileRoute("/_private/surveys/$surveyId/results")({
  validateSearch: validateResultsSearch,
  loader: ({ context: { queryClient }, params }) => loadSurvey(queryClient, params.surveyId),
});
