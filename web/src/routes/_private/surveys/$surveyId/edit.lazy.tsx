import { createLazyFileRoute } from "@tanstack/react-router";
import { EditorPage } from "../../../../editor/EditorPage";
import { SurveyNotAvailable } from "../../../../surveyList/surveyPlaceholder";

export const Route = createLazyFileRoute("/_private/surveys/$surveyId/edit")({
  component: Editor,
  notFoundComponent: SurveyNotAvailable,
});

function Editor() {
  const { surveyId } = Route.useParams();
  // Another survey is another editor: new reads, new savers, a new Creator.
  return <EditorPage key={surveyId} surveyId={surveyId} />;
}
