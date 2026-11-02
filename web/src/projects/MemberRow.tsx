import type { MouseEvent } from "react";
import type { Member } from "../api/projects";
import { iconHtml } from "../shell/surveyjs-site/icons";
import type { MemberControls } from "./controls";

/**
 * One member of a project card (`the site's page markup`, the users list): for admins the remove "x", the
 * display name, the Admin badge of an admin member, the Pending badge of an invited email, and for admins the Make Admin or Remove Admin
 * Rights pill.
 */
export function MemberRow({
  member,
  controls,
  admin,
  onRemove,
  onRoleChange,
}: {
  member: Member;
  controls: MemberControls;
  /** The viewer is an admin of the project. */
  admin: boolean;
  onRemove: () => void;
  onRoleChange: (role: Member["role"]) => void;
}) {
  const action = (run: () => void) => (event: MouseEvent) => {
    event.preventDefault();
    run();
  };
  return (
    <div
      className={
        admin
          ? "v2-class---account-page__project-user"
          : "v2-class---account-page__project-user v2-class---account-page__project-user--not-admin"
      }
    >
      <div className="v2-class---account-page__project-user-left">
        {controls.remove && (
          <div
            className="v2-class---account-page__project-user-remove-button v2-class---account-page__project-user-action"
            role="button"
            tabIndex={0}
            aria-label={`Remove ${member.displayName}`}
            onClick={onRemove}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onRemove();
              }
            }}
            dangerouslySetInnerHTML={iconHtml("pages/account/Remove")}
          />
        )}

        <div className="v2-class---account-page__project-user-display-name">
          {member.displayName}
        </div>

        {member.status === "pending" && (
          <div className="v2-class---account-page__project-user-admin-label">Pending</div>
        )}

        {member.role === "admin" && (
          <div className="v2-class---account-page__project-user-admin-label">Admin</div>
        )}
      </div>

      {admin && (
        <div className="v2-class---account-page__project-user-right">
          {controls.removeAdminRights && (
            <a
              href="#"
              className="v2-class---account-page__project-button v2-class---account-page__project-user-action"
              onClick={action(() => onRoleChange("user"))}
            >
              Remove Admin Rights
            </a>
          )}
          {controls.makeAdmin && (
            <a
              href="#"
              className="v2-class---account-page__project-button v2-class---account-page__project-button--make-admin v2-class---account-page__project-user-action"
              onClick={action(() => onRoleChange("admin"))}
            >
              Make Admin
            </a>
          )}
        </div>
      )}
    </div>
  );
}
