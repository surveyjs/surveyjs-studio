import { createLazyFileRoute } from "@tanstack/react-router";
import { RunPage } from "../../run/RunPage";

export const Route = createLazyFileRoute("/s/$surveyId")({
  component: Run,
});

function Run() {
  const { surveyId } = Route.useParams();
  // Another survey is another page: a new read and a new survey model.
  return <RunPage key={surveyId} surveyId={surveyId} search={Route.useSearch()} />;
}
