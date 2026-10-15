import { createFileRoute, redirect } from "@tanstack/react-router";
import { ApiError } from "../../api/client";
import { projectsQueryOptions } from "../../api/projects";
import { hasArchivedQueryOptions, surveyListQueryOptions } from "../../api/surveys";
import { surveyListParams, validateSurveyListSearch } from "../../surveyList/search";

/** My Surveys (`/`): the page component is in index.lazy.tsx. */
export const Route = createFileRoute("/_private/")({
  validateSearch: validateSurveyListSearch,
  loaderDeps: ({ search }) => surveyListParams(search),
  loader: async ({ context: { queryClient }, deps }) => {
    try {
      await Promise.all([
        queryClient.ensureInfiniteQueryData(surveyListQueryOptions(deps)),
        queryClient.ensureQueryData(hasArchivedQueryOptions(deps.project)),
        queryClient.ensureQueryData(projectsQueryOptions),
      ]);
    } catch (error) {
      // An unknown project, or one the user is not a member of: fall back to Personal Surveys,
      // as the legacy site does.
      if (error instanceof ApiError && error.problem.status === 404) {
        throw redirect({ to: "/", replace: true });
      }
      throw error;
    }
  },
});
