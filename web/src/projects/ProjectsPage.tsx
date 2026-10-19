import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import {
  projectsQueryOptions,
  refreshProjects,
  useCreateProject,
  useRenameProject,
} from "../api/projects";
import { iconHtml } from "../shell/surveyjs-site/icons";
import { PageHeader } from "../surveyList/PageHeader";
import { isProjectGone } from "./messages";
import { ProjectCard } from "./ProjectCard";
import { ProjectNameEditor } from "./ProjectNameEditor";
import styles from "./ProjectsPage.module.css";

const privateRoute = getRouteApi("/_private");

/**
 * The Projects page in the markup of surveyjs.io's `the site's page markup`
 * (D14): the intro, a card per project of the user in the server's order, and Create a Project.
 * The route loader has fetched the projects. Nothing changes before the server answers: the page
 * shows the lists the server returns after each action.
 */
export function ProjectsPage() {
  const { user } = privateRoute.useRouteContext();
  const { data: projects } = useSuspenseQuery(projectsQueryOptions);
  const queryClient = useQueryClient();
  const createProject = useCreateProject();
  const renameProject = useRenameProject();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);

  const rename = (projectId: string) => (name: string) =>
    renameProject.mutateAsync({ projectId, name }).catch((failure: unknown) => {
      // The project is gone, or the user is no longer in it: the list is read again.
      if (isProjectGone(failure)) void refreshProjects(queryClient);
      throw failure;
    });

  return (
    <article className="v2-class---account-page">
      <div className="v2-class---account-page__section-container v2-class---account-page__section-container--selected">
        <section className="v2-class---account-page__projects-section">
          <PageHeader title="Projects" />
          <p className="v2-class---paragraph v2-class---paragraph--last-with-padding">
            Create multiple projects to group the web forms you have built with{" "}
            <Link className="v2-class---paragraph-link" to="/">
              the Free Survey Tool
            </Link>
            . Add registered users to share the forms with them and edit your forms together.
          </p>

          {(projects.length > 0 || creating) && (
            <div className="v2-class---account-page__projects">
              {projects.map((project) =>
                renaming === project.id ? (
                  <ProjectNameEditor
                    key={project.id}
                    name={project.name}
                    action="rename"
                    onSave={rename(project.id)}
                    onClose={() => setRenaming(null)}
                  />
                ) : (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    viewerId={user.id}
                    onRename={() => setRenaming(project.id)}
                  />
                ),
              )}
              {creating && (
                <ProjectNameEditor
                  action="create"
                  onSave={(name) => createProject.mutateAsync(name)}
                  onClose={() => setCreating(false)}
                />
              )}
            </div>
          )}

          {!creating && (
            <div
              className="v2-class---account-page__add-project-button"
              role="button"
              tabIndex={0}
              onClick={() => setCreating(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setCreating(true);
                }
              }}
            >
              <span
                className={styles.icon}
                dangerouslySetInnerHTML={iconHtml("pages/account/Add")}
              />
              Create a Project
            </div>
          )}
        </section>
      </div>
    </article>
  );
}
