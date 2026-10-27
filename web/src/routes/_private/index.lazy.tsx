import { createLazyFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { rememberProject } from "../../surveyList/lastProject";
import { surveyListParams } from "../../surveyList/search";
import { SurveyListPage } from "../../surveyList/SurveyListPage";

export const Route = createLazyFileRoute("/_private/")({ component: SurveyList });

function SurveyList() {
  const params = surveyListParams(Route.useSearch());
  const { user } = Route.useRouteContext();
  // Remembered once the list is shown, not in the loader: a link's preload (on hover) runs the
  // loader for a list the user has not opened.
  useEffect(() => rememberProject(user.id, params.project), [user.id, params.project]);
  // A new scope or view starts with a fresh page: closed menu, no create error.
  return <SurveyListPage key={`${params.project}|${params.archived}`} {...params} />;
}
