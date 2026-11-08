import { appPath } from "../account/returnTo";
import { AccountPage } from "../account/AccountForm";
import { navigateTo } from "../navigation";
import { PageHeader } from "../surveyList/PageHeader";
import styles from "./sandbox.module.css";
import type { SandboxMembership, SandboxProject, SandboxUser } from "./seed-types";
import { setSessionCookie } from "./store";

/**
 * The sandbox's sign-in (D4): one button per seed user. Picking one sets the session cookie the
 * mock reads (D3) and goes to `returnTo` (an address of this app only) or My Surveys.
 */
export function AccountPicker({
  users,
  projects,
  memberships,
  returnTo,
}: {
  users: readonly SandboxUser[];
  projects: readonly SandboxProject[];
  memberships: readonly SandboxMembership[];
  returnTo: string | undefined;
}) {
  const pick = (user: SandboxUser) => {
    setSessionCookie(user.id);
    navigateTo(appPath(returnTo));
  };
  const roles = (user: SandboxUser): string[] =>
    memberships.flatMap((membership) => {
      const project = projects.find((candidate) => candidate.id === membership.projectId);
      return membership.userId === user.id && project
        ? [`${project.name}: ${membership.role}`]
        : [];
    });

  return (
    <AccountPage>
      <PageHeader title="Pick an account" />
      <p className="v2-class---paragraph">
        This demo has no passwords. Pick who you want to be; you can sign out and pick another.
      </p>
      <ul className={styles.accounts}>
        {users.map((user) => {
          const projectRoles = roles(user);
          return (
            <li key={user.id}>
              <button type="button" className={styles.account} onClick={() => pick(user)}>
                <span className={styles.accountName}>{user.displayName}</span>
                <span className={styles.accountEmail}>{user.email}</span>
                <span className={styles.accountProjects}>
                  {projectRoles.length > 0 ? projectRoles.join(", ") : "No projects"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </AccountPage>
  );
}
