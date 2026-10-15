import { createLazyFileRoute } from "@tanstack/react-router";
import { SurveyNotAvailable, SurveyPlaceholder } from "../../../../surveyList/surveyPlaceholder";

export const Route = createLazyFileRoute("/_private/surveys/$surveyId/results")({
  component: Placeholder,
  notFoundComponent: SurveyNotAvailable,
});

function Placeholder() {
  const { surveyId } = Route.useParams();
  return <SurveyPlaceholder surveyId={surveyId} text="Survey results arrive in a later version." />;
}
