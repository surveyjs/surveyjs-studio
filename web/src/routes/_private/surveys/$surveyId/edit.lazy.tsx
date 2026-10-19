import { createLazyFileRoute } from "@tanstack/react-router";
import { SurveyNotAvailable, SurveyPlaceholder } from "../../../../surveyList/surveyPlaceholder";

export const Route = createLazyFileRoute("/_private/surveys/$surveyId/edit")({
  component: Placeholder,
  notFoundComponent: SurveyNotAvailable,
});

function Placeholder() {
  const { surveyId } = Route.useParams();
  return (
    <SurveyPlaceholder surveyId={surveyId} text="The survey editor arrives in a later version." />
  );
}
