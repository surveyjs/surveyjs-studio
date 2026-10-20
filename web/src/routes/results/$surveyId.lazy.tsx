import { createLazyFileRoute, getRouteApi } from "@tanstack/react-router";
import { PublicResultsPage } from "../../results/PublicResultsPage";
import { renderShellStyles } from "../../shell/registry";

export const Route = createLazyFileRoute("/results/$surveyId")({
  component: PublicResults,
});

const rootRoute = getRouteApi("__root__");

function PublicResults() {
  const { surveyId } = Route.useParams();
  const config = rootRoute.useLoaderData();
  // No shell (ADR 0016 R19), but the configured shell's styles. Another survey is another page: a
  // new read and new widgets.
  return renderShellStyles(config.shell, <PublicResultsPage key={surveyId} surveyId={surveyId} />);
}
