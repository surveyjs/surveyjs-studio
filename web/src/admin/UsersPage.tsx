import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Field } from "../account/AccountForm";
import {
  useCreateUser,
  useDeleteUser,
  useResetLink,
  useUpdateUser,
  usersQueryOptions,
  type AdminUser,
  type PasswordLink,
} from "../api/admin";
import { ApiError } from "../api/client";
import { PageHeader } from "../surveyList/PageHeader";
import styles from "./UsersPage.module.css";

const STATUS: Record<AdminUser["status"], string> = {
  invited: "Invited",
  active: "Active",
  disabled: "Disabled",
};

/** The server's message for a refused action, or a general one. */
function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? (error.problem.detail ?? error.problem.title) : fallback;
}

const dateTime = (iso: string | null) =>
  iso === null
    ? "Never"
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(iso),
      );

/** A one-time link, shown once: its text to select, a copy button, and when it expires. */
function LinkBox({ name, link, onDone }: { name: string; link: PasswordLink; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className={styles.link}>
      <p className="v2-class---paragraph">
        The set-password link for <strong>{name}</strong>. Send it to them yourself. It is shown
        only now, works once, and expires on {dateTime(link.expiresAt)}.
      </p>
      <div className={styles.linkRow}>
        <input
          className="v2-class---text-edit__input"
          readOnly
          aria-label="Set-password link"
          value={link.url}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(link.url).then(() => setCopied(true));
          }}
        >
          Copy link
        </button>
        <button type="button" onClick={onDone}>
          Done
        </button>
      </div>
      {copied && <p className="v2-class---paragraph">Copied.</p>}
    </div>
  );
}

/**
 * The instance admin's Users page (S12–S18): every local account with its role, status and last
 * sign-in; a form that creates a user and shows their one-time link; and per user Make admin or
 * Make user, Disable or Enable, Reset password and Delete, each after a confirmation. There is no
 * email: the admin sends each link themselves.
 */
export function UsersPage() {
  const { data: users } = useSuspenseQuery(usersQueryOptions);
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const resetLink = useResetLink();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [shown, setShown] = useState<{ name: string; link: PasswordLink } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Runs an action, showing the server's refusal (and clearing the previous one). */
  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(messageOf(failure, fallback));
    }
  };

  const create = () =>
    run(async () => {
      const created = await createUser.mutateAsync({
        email: email.trim(),
        displayName: displayName.trim(),
        instanceRole: makeAdmin ? "admin" : "user",
      });
      setShown({ name: created.user.displayName, link: created.link });
      setEmail("");
      setDisplayName("");
      setMakeAdmin(false);
    }, "Could not create the user. Please try again.");

  const confirmThen = (question: string, action: () => Promise<unknown>) => {
    if (!window.confirm(question)) return;
    void run(action, "Could not change the user. Please try again.");
  };

  return (
    <article className={styles.page}>
      <PageHeader title="Users" />
      <p className="v2-class---paragraph">
        Create a user to get a one-time link that sets their password, and send it to them yourself.
        Instance admins manage the users and every project.
      </p>

      <form
        className={styles.create}
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Field label="Email" type="email" autoComplete="off" value={email} onChange={setEmail} />
        <Field
          label="Name"
          type="text"
          autoComplete="off"
          value={displayName}
          onChange={setDisplayName}
        />
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={makeAdmin}
            onChange={(event) => setMakeAdmin(event.target.checked)}
          />
          Instance admin
        </label>
        <button type="submit" disabled={createUser.isPending}>
          Create user
        </button>
      </form>

      {shown && <LinkBox name={shown.name} link={shown.link} onDone={() => setShown(null)} />}
      {error !== null && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <div className={styles.tableBox}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col">Last sign-in</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const admin = user.instanceRole === "admin";
              const disabled = user.status === "disabled";
              return (
                <tr key={user.id}>
                  <th scope="row">{user.displayName}</th>
                  <td>{user.email}</td>
                  <td>{admin ? "Admin" : "User"}</td>
                  <td>{STATUS[user.status]}</td>
                  <td>{dateTime(user.lastSignInAt)}</td>
                  <td className={styles.actions}>
                    <button
                      type="button"
                      onClick={() =>
                        confirmThen(
                          admin
                            ? `Make ${user.displayName} a user? They can no longer manage users and every project.`
                            : `Make ${user.displayName} an instance admin? They can manage users and every project.`,
                          () =>
                            updateUser.mutateAsync({
                              userId: user.id,
                              patch: { instanceRole: admin ? "user" : "admin" },
                            }),
                        )
                      }
                    >
                      {admin ? "Make user" : "Make admin"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        confirmThen(
                          disabled
                            ? `Enable ${user.displayName}? They can sign in again.`
                            : `Disable ${user.displayName}? They are signed out within a minute and cannot sign in.`,
                          () =>
                            updateUser.mutateAsync({
                              userId: user.id,
                              patch: { status: disabled ? "active" : "disabled" },
                            }),
                        )
                      }
                    >
                      {disabled ? "Enable" : "Disable"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        confirmThen(
                          `Reset the password of ${user.displayName}? Their password stops working, they are signed out, and you get a new link for them.`,
                          async () => {
                            const link = await resetLink.mutateAsync(user.id);
                            setShown({ name: user.displayName, link });
                          },
                        )
                      }
                    >
                      Reset password
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        confirmThen(
                          `Delete ${user.displayName}? Their personal surveys and results are erased, and they leave every project.`,
                          () => deleteUser.mutateAsync(user.id),
                        )
                      }
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}

/** The page for a signed-in user who is not an instance admin. */
export function UsersNotAllowed() {
  return (
    <article className={styles.page}>
      <PageHeader title="Users" />
      <p className="v2-class---paragraph">Only instance admins can manage users.</p>
    </article>
  );
}
