import { ApiError } from "../api/client";

/** R22: new texts (the site asks a bare "Are you sure?"). */
export const DELETE_PROJECT_CONFIRMATION =
  "Delete this project? Its surveys will move to the project owner's Personal Surveys, or to you if the owner has left.";
export const LEAVE_PROJECT_CONFIRMATION =
  "Leave this project? You will lose access to its surveys.";
export const removeMemberConfirmation = (name: string): string =>
  `Remove ${name} from this project?`;

export type ProjectAction =
  "create" | "rename" | "delete" | "leave" | "add" | "change-role" | "remove" | "load-members";

const VERBS: Record<ProjectAction, string> = {
  create: "create the project",
  rename: "rename the project",
  delete: "delete the project",
  leave: "leave the project",
  add: "add the member",
  "change-role": "change the member's role",
  remove: "remove the member",
  "load-members": "load the members",
};

export const LAST_ADMIN_TEXT =
  "A project must keep at least one admin. Make another member an admin first.";
export const ADMINS_ONLY_TEXT = "Only project admins can do this.";
export const NAME_REQUIRED_TEXT = "Enter a project name.";
export const userNotFoundText = (email: string): string =>
  `${email} is not a registered surveyjs.io user. Ask them to sign up first.`;
export const alreadyMemberText = (email: string): string =>
  `${email} is already a member of this project.`;
export const alreadyInvitedText = (email: string): string => `${email} is already invited.`;
export const willJoinText = (email: string): string =>
  `${email} will join when they first sign in.`;
export const actionFailedText = (action: ProjectAction): string =>
  `Could not ${VERBS[action]}. Please try again.`;

/** The text a failed action shows in its card (R22); `email` is the address typed (add only). */
export function projectErrorText(error: unknown, action: ProjectAction, email = ""): string {
  if (error instanceof ApiError) {
    const { code } = error.problem;
    if (code === "user-not-found") return userNotFoundText(email);
    if (code === "already-member") return alreadyMemberText(email);
    if (code === "already-invited") return alreadyInvitedText(email);
    if (code === "last-admin") return LAST_ADMIN_TEXT;
    if (code === "forbidden") return ADMINS_ONLY_TEXT;
    if (code === "validation-failed" && (action === "create" || action === "rename")) {
      return NAME_REQUIRED_TEXT;
    }
  }
  return actionFailedText(action);
}

/** The project is gone, or the user is no longer in it: the page reads the list again. */
export const isProjectGone = (error: unknown): boolean =>
  error instanceof ApiError && error.problem.code === "not-found";
