import { useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { projectsQueryOptions } from "../api/projects";
import { hasArchivedQueryOptions, surveyListQueryOptions, useCreateSurvey } from "../api/surveys";
import { iconHtml } from "../shell/surveyjs-site/icons";
import { SiteButton } from "../shell/surveyjs-site/SiteButton";
import { ActiveArchivedSwitch } from "./ActiveArchivedSwitch";
import { PageHeader } from "./PageHeader";
import { ProjectSelector } from "./ProjectSelector";
import { surveyListSearch, type SurveyListParams } from "./search";
import styles from "./SurveyListPage.module.css";
import { SurveyRow } from "./SurveyRow";
import { failureMessage, useSurveyActions } from "./useSurveyActions";

/**
 * The My Surveys page in the markup of surveyjs.io's `the site's page markup` (D14):
 * the Active/Archived switch, the project drop-down, Create a Survey, and the list of the scope's
 * surveys, newest first. Like surveyjs.io, the page ends up holding the whole list, so the browser's
 * Find sees every survey: the pages after the first load one after another without a click. A page
 * that fails stops that, with a message and "Load more" to try it again. Each row has the rename
 * pencil and the "…" menu; a failed row action shows one message under the actions until the next
 * action. The route loader has fetched the first page, the archived check and the projects.
 */
export function SurveyListPage({ project, archived }: SurveyListParams) {
  const navigate = useNavigate();
  const list = useSuspenseInfiniteQuery(surveyListQueryOptions({ project, archived }));
  const { data: hasArchived } = useSuspenseQuery(hasArchivedQueryOptions(project));
  const { data: projects } = useSuspenseQuery(projectsQueryOptions);
  const create = useCreateSurvey();
  const { error: actionError, actions } = useSurveyActions();
  // A ref, not isPending: two clicks in the same tick both see the old render.
  const creating = useRef(false);

  const surveys = list.data.pages.flatMap((page) => page.items);

  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = list;
  // The page count is a dependency: a fast page can arrive without a render that shows it fetching,
  // and the other values alone would then not change.
  const pageCount = list.data.pages.length;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [pageCount, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  const createSurvey = () => {
    if (creating.current) return;
    creating.current = true;
    create.mutate(project, {
      onSuccess: (survey) =>
        void navigate({ to: "/surveys/$surveyId/edit", params: { surveyId: survey.id } }),
      onError: () => {
        creating.current = false;
      },
    });
  };

  return (
    <>
      <article className="v2-class---my-surveys-page">
        <div className="v2-class---my-surveys-page__container">
          <div className="v2-class---my-surveys-page__header">
            <PageHeader title="My Surveys" />
          </div>

          <div className="v2-class---my-surveys-page__actions-container">
            <div className="v2-class---my-surveys-page__actions">
              {(archived || hasArchived) && (
                <div className="v2-class---my-surveys-page__active-archived-switcher">
                  <ActiveArchivedSwitch
                    archived={archived}
                    onChange={(showArchived) =>
                      void navigate({
                        to: "/",
                        search: surveyListSearch({ project, archived: showArchived }),
                      })
                    }
                  />
                </div>
              )}
            </div>
            <div className="v2-class---my-surveys-page__actions">
              {projects.length > 0 && <ProjectSelector projects={projects} project={project} />}
              {!archived && (
                <SiteButton
                  text="Create a Survey"
                  style="Brand"
                  mode="Primary"
                  size="Small"
                  disabled={create.isPending}
                  onClick={createSurvey}
                />
              )}
            </div>
          </div>

          {create.isError && (
            <p className={styles.error} role="alert">
              {failureMessage(create.error, "Could not create a survey. Please try again.")}
            </p>
          )}

          {actionError !== null && (
            <p className={styles.error} role="alert">
              {actionError}
            </p>
          )}

          {surveys.length === 0 ? (
            <div className="v2-class---my-surveys-page__no-surveys-container">
              <p className="v2-class---paragraph">
                No surveys yet.
                <br className="v2-class---br" />
                Click the button below to create your first survey.
              </p>

              <SiteButton
                text="Create a Survey"
                style="Brand"
                mode="Primary"
                size="Medium"
                disabled={create.isPending}
                onClick={createSurvey}
              />
            </div>
          ) : (
            <div
              className="v2-class---my-surveys-page__list v2-class---my-surveys-page__list--table-view"
              aria-busy={hasNextPage && !isFetchNextPageError}
            >
              {surveys.map((survey) => (
                <SurveyRow
                  key={survey.id}
                  survey={survey}
                  archived={archived}
                  projects={projects}
                  actions={actions}
                />
              ))}
            </div>
          )}

          {isFetchNextPageError && (
            <p className={styles.error} role="alert">
              Could not load more surveys. Please try again.
            </p>
          )}

          {isFetchNextPageError && hasNextPage && (
            <div className={styles.loadMore}>
              <SiteButton
                text="Load more"
                style="Brand"
                mode="Secondary"
                size="Small"
                disabled={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              />
            </div>
          )}
        </div>
      </article>

      {create.isPending && (
        <div id="my-surveys-loading">
          <div id="my-surveys-loading-indicator" className="v2-class---loading">
            <div
              className="v2-class---loading__indicator"
              dangerouslySetInnerHTML={iconHtml("64x64/Loading")}
            />
          </div>
        </div>
      )}
    </>
  );
}
