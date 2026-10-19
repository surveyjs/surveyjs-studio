import { createLazyFileRoute } from "@tanstack/react-router";
import { PublicResultsPage } from "../../results/PublicResultsPage";

export const Route = createLazyFileRoute("/results/$surveyId")({
  component: PublicResults,
});

function PublicResults() {
  const { surveyId } = Route.useParams();
  // Another survey is another page: a new read and new widgets.
  return <PublicResultsPage key={surveyId} surveyId={surveyId} />;
}
