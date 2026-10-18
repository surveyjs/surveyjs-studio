import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import {
  membersQueryOptions,
  refreshProjects,
  useAddMember,
  useChangeMemberRole,
  useDeleteProject,
  useRemoveMember,
  type Member,
  type Project,
} from "../api/projects";
import { iconHtml } from "../shell/surveyjs-site/icons";
import { AddMemberForm } from "./AddMemberForm";
import { memberControls, projectControls } from "./controls";
import { MemberRow } from "./MemberRow";
import {
  DELETE_PROJECT_CONFIRMATION,
  LEAVE_PROJECT_CONFIRMATION,
  actionFailedText,
  isProjectGone,
  projectErrorText,
  removeMemberConfirmation,
  type ProjectAction,
} from "./messages";
import styles from "./ProjectsPage.module.css";

/**
 * One project of the Projects page (`the site's page markup`, the `<details>` card): the name and the
 * project links in the summary; the members, read when the card first opens, and for admins the
 * Add a New Member form in the content. Every action waits for the server's answer; a failure shows
 * one error in the card (and opens it) until the next action.
 */
export function ProjectCard({
  project,
  viewerId,
  onRename,
}: {
  project: Project;
  /** The signed-in user's id. */
  viewerId: string;
  onRename: () => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One action at a time: a second click while a request is in flight is ignored.
  const busy = useRef(false);
  const members = useQuery({ ...membersQueryOptions(project.id), enabled: open });
  const deleteProject = useDeleteProject();
  const addMember = useAddMember();
  const changeRole = useChangeMemberRole();
  const removeMember = useRemoveMember();
  const controls = projectControls(project);
  const admin = controls.manage;

  /** Runs `request`; on failure shows its error in the card. Resolves to whether it succeeded. */
  async function run(
    action: ProjectAction,
    request: () => Promise<unknown>,
    email?: string,
  ): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setError(null);
    try {
      await request();
      return true;
    } catch (failure) {
      // The project is gone, or the user is no longer in it: the list is read again.
      if (isProjectGone(failure)) void refreshProjects(queryClient);
      setError(projectErrorText(failure, action, email));
      setOpen(true);
      return false;
    } finally {
      busy.current = false;
    }
  }

  const leave = () => {
    if (!window.confirm(LEAVE_PROJECT_CONFIRMATION)) return;
    void run("leave", () =>
      removeMember.mutateAsync({ projectId: project.id, userId: viewerId, self: true }),
    );
  };

  const remove = () => {
    if (!window.confirm(DELETE_PROJECT_CONFIRMATION)) return;
    void run("delete", () => deleteProject.mutateAsync(project.id));
  };

  const removeMemberRow = (member: Member, self: boolean) => {
    if (self) {
      // The admin's own "x" means leaving the project.
      if (!window.confirm(LEAVE_PROJECT_CONFIRMATION)) return;
      void run("leave", () =>
        removeMember.mutateAsync({ projectId: project.id, userId: member.userId, self: true }),
      );
      return;
    }
    if (!window.confirm(removeMemberConfirmation(member.displayName))) return;
    void run("remove", () =>
      removeMember.mutateAsync({ projectId: project.id, userId: member.userId, self: false }),
    );
  };

  const changeMemberRole = (member: Member, role: Member["role"]) =>
    void run("change-role", () =>
      changeRole.mutateAsync({ projectId: project.id, userId: member.userId, role }),
    );

  const add = (email: string) =>
    run("add", () => addMember.mutateAsync({ projectId: project.id, email }), email);

  const projectLinks = (
    <>
      {controls.manage && (
        <>
          <ProjectLink onClick={onRename}>Rename</ProjectLink>
          <ProjectLink red onClick={remove}>
            Remove
          </ProjectLink>
        </>
      )}
      {controls.leave && (
        <ProjectLink red onClick={leave}>
          Leave Project
        </ProjectLink>
      )}
    </>
  );

  const shownError = error ?? (members.isError ? actionFailedText("load-members") : null);

  return (
    <details className="v2-class---account-page__project" open={open}>
      <summary
        onClick={(event) => {
          // Controlled: the card opens and closes through its state, not the browser's toggle.
          event.preventDefault();
          setOpen((wasOpen) => !wasOpen);
        }}
      >
        <div className="v2-class---account-page__project-summary">
          <div className="v2-class---account-page__project-summary-left">
            <div className="v2-class---account-page__project__expand-collapse-button">
              <div
                className="v2-class---expand-collapse-button"
                dangerouslySetInnerHTML={iconHtml("Expand-Collapse-Arrow")}
              />
            </div>

            <div className="v2-class---account-page__project-title">{project.name}</div>
          </div>

          <div className="v2-class---account-page__project-summary-right v2-class---account-page--not-for-mobile">
            {projectLinks}
          </div>
        </div>
      </summary>

      <div className="v2-class---account-page__project-hidden-content">
        <div className="v2-class---account-page__project-summary-right v2-class---account-page--for-mobile-only">
          {projectLinks}
        </div>

        {shownError && (
          <p className={styles.error} role="alert">
            {shownError}
          </p>
        )}

        {members.isPending && open && (
          <p className="v2-class---paragraph" role="status">
            Loading the members…
          </p>
        )}

        {members.data && (
          <div className="v2-class---account-page__project-users-list">
            {members.data.map((member) => {
              const memberControl = memberControls(project, member, viewerId);
              return (
                <MemberRow
                  key={member.userId}
                  member={member}
                  controls={memberControl}
                  admin={admin}
                  onRemove={() => removeMemberRow(member, memberControl.self)}
                  onRoleChange={(role) => changeMemberRole(member, role)}
                />
              );
            })}
          </div>
        )}

        {controls.addMember && <AddMemberForm onAdd={add} />}
      </div>
    </details>
  );
}

/** A link of the card's summary (Rename, Remove, Leave Project); a click does not toggle the card. */
function ProjectLink({
  red,
  onClick,
  children,
}: {
  red?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <a
      className={
        red
          ? "v2-class---account-page__project-link v2-class---account-page__project-link--red"
          : "v2-class---account-page__project-link"
      }
      href="#"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </a>
  );
}
