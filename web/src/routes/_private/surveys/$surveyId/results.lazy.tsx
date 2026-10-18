import { createLazyFileRoute } from "@tanstack/react-router";
import { ResultsPage } from "../../../../results/ResultsPage";
import { resultsTab, validateResultsSearch } from "../../../../results/search";
import { SurveyNotAvailable } from "../../../../surveyList/surveyPlaceholder";

export const Route = createLazyFileRoute("/_private/surveys/$surveyId/results")({
  component: Results,
  notFoundComponent: SurveyNotAvailable,
});

function Results() {
  const { surveyId } = Route.useParams();
  // Validated again: the router keeps the URL's own members next to what validateSearch returns,
  // so an unknown `tab` (`?tab=bogus`) would still be there.
  const tab = resultsTab(validateResultsSearch(Route.useSearch()));
  // Another survey is another page: new reads, new savers, new widgets.
  return <ResultsPage key={surveyId} surveyId={surveyId} tab={tab} />;
}
