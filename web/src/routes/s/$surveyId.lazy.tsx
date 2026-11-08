import { createLazyFileRoute, getRouteApi } from "@tanstack/react-router";
import { RunPage } from "../../run/RunPage";
import { renderRunFooter } from "../../shell/registry";

export const Route = createLazyFileRoute("/s/$surveyId")({
  component: Run,
});

const rootRoute = getRouteApi("__root__");

function Run() {
  const { surveyId } = Route.useParams();
  const config = rootRoute.useLoaderData();
  // Another survey is another page: a new read and a new survey model.
  return (
    <>
      <RunPage key={surveyId} surveyId={surveyId} search={Route.useSearch()} />
      {renderRunFooter(config)}
    </>
  );
}
