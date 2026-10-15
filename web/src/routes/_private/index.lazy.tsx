import { createLazyFileRoute } from "@tanstack/react-router";
import { surveyListParams } from "../../surveyList/search";
import { SurveyListPage } from "../../surveyList/SurveyListPage";

export const Route = createLazyFileRoute("/_private/")({ component: SurveyList });

function SurveyList() {
  const params = surveyListParams(Route.useSearch());
  // A new scope or view starts with a fresh page: closed menu, no create error.
  return <SurveyListPage key={`${params.project}|${params.archived}`} {...params} />;
}
