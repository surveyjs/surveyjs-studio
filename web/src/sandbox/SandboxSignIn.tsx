import { AccountPicker } from "./AccountPicker";
import { sandboxStore } from "./start";

/** The sign-in page of the sandbox build: the picker over the users in the store. */
export default function SandboxSignIn({ returnTo }: { returnTo: string | undefined }) {
  const { users, projects, memberships } = sandboxStore().read();
  return (
    <AccountPicker
      users={users}
      projects={projects}
      memberships={memberships}
      returnTo={returnTo}
    />
  );
}
