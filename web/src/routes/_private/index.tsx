import { createFileRoute, redirect } from "@tanstack/react-router";
import { ApiError } from "../../api/client";
import { projectsQueryOptions } from "../../api/projects";
import { hasArchivedQueryOptions, surveyListQueryOptions } from "../../api/surveys";
import { lastProject } from "../../surveyList/lastProject";
import {
  surveyListParams,
  surveyListSearch,
  validateSurveyListSearch,
} from "../../surveyList/search";

/** My Surveys (`/`): the page component is in index.lazy.tsx. */
export const Route = createFileRoute("/_private/")({
  validateSearch: validateSurveyListSearch,
  beforeLoad: ({ context: { user }, search }) => {
    // `/` without a list is "My Surveys": the list the user looked at last (the page remembers it),
    // as surveyjs.io's `/service/mysurveys` is. Replaced by that list's address, so Back never
    // comes to an address whose meaning has changed since.
    if (search.project === undefined) {
      throw redirect({
        to: "/",
        search: surveyListSearch({
          ...surveyListParams(search),
          project: lastProject(user.id) ?? "personal",
        }),
        replace: true,
      });
    }
  },
  loaderDeps: ({ search }) => surveyListParams(search),
  loader: async ({ context: { queryClient }, deps }) => {
    try {
      await Promise.all([
        queryClient.ensureInfiniteQueryData(surveyListQueryOptions(deps)),
        queryClient.ensureQueryData(hasArchivedQueryOptions(deps.project)),
        queryClient.ensureQueryData(projectsQueryOptions),
      ]);
    } catch (error) {
      // An unknown project, or one the user is not a member of (a remembered one they have left
      // too): fall back to Personal Surveys, as the legacy site does. Named, not `/`, which could
      // open the remembered project again.
      if (error instanceof ApiError && error.problem.status === 404) {
        throw redirect({ to: "/", search: { project: "personal" }, replace: true });
      }
      throw error;
    }
  },
});
