import { createLazyFileRoute, getRouteApi } from "@tanstack/react-router";
import { PublicResultsPage } from "../../results/PublicResultsPage";
import { renderPublicPage } from "../../shell/registry";

export const Route = createLazyFileRoute("/results/$surveyId")({
  component: PublicResults,
});

const rootRoute = getRouteApi("__root__");

function PublicResults() {
  const { surveyId } = Route.useParams();
  const config = rootRoute.useLoaderData();
  // No account shell (ADR 0016 R19): the configured shell's styles, or the powered-by frame.
  // Another survey is another page: a new read and new widgets.
  return renderPublicPage(config, <PublicResultsPage key={surveyId} surveyId={surveyId} />);
}
