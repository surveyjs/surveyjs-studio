import { createLazyFileRoute } from "@tanstack/react-router";
import { HistoryPage } from "../../../../history/HistoryPage";
import { SurveyNotAvailable } from "../../../../surveyList/surveyPlaceholder";

export const Route = createLazyFileRoute("/_private/surveys/$surveyId/history")({
  component: History,
  notFoundComponent: SurveyNotAvailable,
});

function History() {
  const { surveyId } = Route.useParams();
  return <HistoryPage surveyId={surveyId} />;
}
