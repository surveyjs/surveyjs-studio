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
  // A shell with a footer of its own (self-hosted) replaces the Form Library's brand block, whose
  // logo comes from surveyjs.io (S11: no calls to other sites).
  const footer = renderRunFooter(config);
  // Another survey is another page: a new read and a new survey model.
  return (
    <>
      <RunPage
        key={surveyId}
        surveyId={surveyId}
        search={Route.useSearch()}
        brandInfo={footer === null}
      />
      {footer}
    </>
  );
}
