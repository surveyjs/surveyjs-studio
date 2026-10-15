import { useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef } from "react";
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

/**
 * The My Surveys page in the markup of surveyjs.io's `the site's page markup` (D14):
 * the Active/Archived switch, the project drop-down, Create a Survey, and the list of the scope's
 * surveys, newest first, with "Load more" when more pages follow. The route loader has fetched the
 * first page, the archived check and the projects.
 */
export function SurveyListPage({ project, archived }: SurveyListParams) {
  const navigate = useNavigate();
  const list = useSuspenseInfiniteQuery(surveyListQueryOptions({ project, archived }));
  const { data: hasArchived } = useSuspenseQuery(hasArchivedQueryOptions(project));
  const { data: projects } = useSuspenseQuery(projectsQueryOptions);
  const create = useCreateSurvey();
  // A ref, not isPending: two clicks in the same tick both see the old render.
  const creating = useRef(false);

  const surveys = list.data.pages.flatMap((page) => page.items);

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
            <p className={styles.createError} role="alert">
              Could not create a survey. Please try again.
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
            <div className="v2-class---my-surveys-page__list v2-class---my-surveys-page__list--table-view">
              {surveys.map((survey) => (
                <SurveyRow key={survey.id} survey={survey} />
              ))}
            </div>
          )}

          {list.hasNextPage && (
            <div className={styles.loadMore}>
              <SiteButton
                text="Load more"
                style="Brand"
                mode="Secondary"
                size="Small"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
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
