import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { Field } from "../account/AccountForm";
import { PROVIDER_NAMES } from "../account/authMethods";
import {
  identitiesQueryOptions,
  useCreateUser,
  useDeleteUser,
  useResetLink,
  useUnlinkIdentity,
  useUpdateUser,
  usersQueryOptions,
  type AdminUser,
  type LinkedIdentity,
  type PasswordLink,
} from "../api/admin";
import { ApiError } from "../api/client";
import { currentUserQueryOptions } from "../api/session";
import { PageHeader } from "../surveyList/PageHeader";
import styles from "./UsersPage.module.css";

/**
 * The status as the table shows it: the account's status, and for an active user whose password
 * was reset, that the new link waits to be used (the account has no password until then).
 */
function statusText(user: AdminUser): string {
  if (user.status === "disabled") return "Disabled";
  if (user.status === "invited") return user.pendingLink ? "Invited" : "Invited, link expired";
  if (user.pendingLink?.purpose === "reset" && !user.hasPassword) return "Reset pending";
  return "Active";
}

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

const date = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(iso));

// The site's page container, as My Surveys has (its margins and width in the surveyjs-site shell);
// the plain shell's layout is this module's.
const PAGE = `v2-class---my-surveys-page__container ${styles.container} ${styles.page}`;

// The site's button classes (button.scss), as the account forms use them.
const PRIMARY = "v2-class---button v2-class---button--brand-primary v2-class---button--medium";
const SECONDARY = "v2-class---button v2-class---button--brand-secondary v2-class---button--small";
const ACTION = "v2-class---button v2-class---button--brand-secondary v2-class---button--x-small";
const DANGER = "v2-class---button v2-class---button--alert-secondary v2-class---button--x-small";

/** A button's text in the site's type for its size. */
function ButtonText({
  size = "small",
  children,
}: {
  size?: "medium" | "small" | "x-small";
  children: string;
}) {
  return (
    <span className={`v2-class---button__text v2-class---button__text--${size}`}>{children}</span>
  );
}

/**
 * A one-time link, shown once: its text to select, a copy button, and when it expires. Where the
 * page may not write to the clipboard (plain HTTP), Copy link selects the text to copy by hand.
 */
function LinkBox({ name, link, onDone }: { name: string; link: PasswordLink; onDone: () => void }) {
  const [copied, setCopied] = useState<"no" | "yes" | "by-hand">("no");
  const input = useRef<HTMLInputElement>(null);
  const copy = async () => {
    try {
      // Undefined outside a secure context: the call throws, as a refused write rejects.
      await navigator.clipboard.writeText(link.url);
      setCopied("yes");
    } catch {
      input.current?.focus();
      input.current?.select();
      setCopied("by-hand");
    }
  };
  return (
    <div role="status" className={styles.link}>
      <p className="v2-class---paragraph">
        The set-password link for <strong>{name}</strong>. Send it to them yourself. It is shown
        only now, works once, and expires on {dateTime(link.expiresAt)}.
      </p>
      <div className={styles.linkRow}>
        <input
          ref={input}
          className="v2-class---text-edit__input"
          readOnly
          aria-label="Set-password link"
          value={link.url}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" className={SECONDARY} onClick={() => void copy()}>
          <ButtonText>Copy link</ButtonText>
        </button>
        <button type="button" className={SECONDARY} onClick={onDone}>
          <ButtonText>Done</ButtonText>
        </button>
      </div>
      {copied === "yes" && <p className="v2-class---paragraph">Copied.</p>}
      {copied === "by-hand" && (
        <p className="v2-class---paragraph">
          This browser does not let the page copy the link here (the page is not on HTTPS). The link
          is selected: press Ctrl+C, or ⌘C on a Mac, to copy it.
        </p>
      )}
    </div>
  );
}

/** What a row needs from the page: whose row it is, and how it runs a confirmed action. */
interface RowActions {
  /** Whether a request of this row is in flight: its buttons are disabled meanwhile. */
  readonly busy: boolean;
  /** Asks `question`; when confirmed, runs `action` as the row's one request in flight. */
  confirmThen(question: string, action: () => Promise<unknown>): void;
}

/** The user's sign-ins: the password, and each linked identity with Unlink. */
function SignIns({
  user,
  own,
  row,
  id,
}: {
  user: AdminUser;
  own: boolean;
  row: RowActions;
  id: string;
}) {
  const identities = useQuery(identitiesQueryOptions(user.id));
  const unlink = useUnlinkIdentity();

  const question = (identity: LinkedIdentity) => {
    const which = `${PROVIDER_NAMES[identity.provider]} sign-in${identity.email ? ` (${identity.email})` : ""}`;
    return own
      ? `Unlink your ${which}? It no longer signs you in, and you are signed out at once.`
      : `Unlink the ${which} of ${user.displayName}? It no longer signs in to their account, and they are signed out. If ${PROVIDER_NAMES[identity.provider]} still gives their email as verified, signing in with it links it again: to keep them out, disable them.`;
  };

  let content;
  if (identities.isPending) {
    content = <p className="v2-class---paragraph">Loading the sign-ins…</p>;
  } else if (identities.isError) {
    content = (
      <p role="alert" className={styles.error}>
        {messageOf(identities.error, "Could not load the sign-ins. Please try again.")}
      </p>
    );
  } else {
    content = (
      <ul className={styles.signInList}>
        <li>{user.hasPassword ? "Password" : "No password"}</li>
        {identities.data.length === 0 && (
          <li>No linked Google, GitHub, Facebook or SurveyJS sign-in</li>
        )}
        {identities.data.map((identity) => (
          <li key={`${identity.provider} ${identity.subject}`} className={styles.signIn}>
            <span>
              <strong>{PROVIDER_NAMES[identity.provider]}</strong>
              {identity.email ? ` ${identity.email}` : ""}, linked {date(identity.linkedAt)}
            </span>
            <button
              type="button"
              className={DANGER}
              disabled={row.busy}
              aria-label={`Unlink ${PROVIDER_NAMES[identity.provider]}${identity.email ? ` ${identity.email}` : ""}`}
              onClick={() =>
                row.confirmThen(question(identity), () =>
                  unlink.mutateAsync({ userId: user.id, identity }),
                )
              }
            >
              <ButtonText size="x-small">Unlink</ButtonText>
            </button>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <tr id={id} className={styles.signInsRow}>
      <td colSpan={5}>
        <div className={styles.signIns}>
          <span className={styles.signInsLabel}>Sign-ins:</span>
          {content}
        </div>
      </td>
    </tr>
  );
}

/** One user: their row, with its actions, and their sign-ins when opened. */
function UserRow({
  user,
  own,
  row,
  onLink,
  onDemotedSelf,
}: {
  user: AdminUser;
  own: boolean;
  row: RowActions;
  onLink: (link: PasswordLink) => void;
  onDemotedSelf: () => Promise<void>;
}) {
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const resetLink = useResetLink();
  const [showSignIns, setShowSignIns] = useState(false);
  const signInsId = useId();
  const admin = user.instanceRole === "admin";
  const disabled = user.status === "disabled";
  const name = user.displayName;

  const roleQuestion = own
    ? "Make yourself a user? You can no longer manage users and every project, and you leave this page."
    : admin
      ? `Make ${name} a user? They can no longer manage users and every project.`
      : `Make ${name} an instance admin? They can manage users and every project.`;
  const statusQuestion = disabled
    ? `Enable ${name}? They can sign in again.`
    : own
      ? "Disable your own account? You are signed out at once and cannot sign in until another admin enables you."
      : `Disable ${name}? They are signed out within a minute and cannot sign in, by any method.`;
  const deleteQuestion = own
    ? "Delete your own account? Your personal surveys and results are erased, you leave every project, and you are signed out at once. You can't undo this."
    : `Delete ${name}? Their personal surveys and results are erased, and they leave every project.`;

  return (
    <>
      <tr>
        <th scope="row">
          <span className={styles.name}>{name}</span>
          <span className={styles.email}>{user.email}</span>
        </th>
        <td>{admin ? "Admin" : "User"}</td>
        <td>{statusText(user)}</td>
        <td>{dateTime(user.lastSignInAt)}</td>
        <td>
          <div className={styles.actions}>
            <button
              type="button"
              className={ACTION}
              disabled={row.busy}
              onClick={() =>
                row.confirmThen(roleQuestion, async () => {
                  await updateUser.mutateAsync({
                    userId: user.id,
                    patch: { instanceRole: admin ? "user" : "admin" },
                  });
                  if (own && admin) await onDemotedSelf();
                })
              }
            >
              <ButtonText size="x-small">{admin ? "Make user" : "Make admin"}</ButtonText>
            </button>
            <button
              type="button"
              className={ACTION}
              disabled={row.busy}
              onClick={() =>
                row.confirmThen(statusQuestion, () =>
                  updateUser.mutateAsync({
                    userId: user.id,
                    patch: { status: disabled ? "active" : "disabled" },
                  }),
                )
              }
            >
              <ButtonText size="x-small">{disabled ? "Enable" : "Disable"}</ButtonText>
            </button>
            <button
              type="button"
              className={ACTION}
              // The server refuses an admin's own reset: it would end this session, and the link
              // with it. Change password is the way.
              disabled={row.busy || own}
              title={own ? "Change your own password in your account." : undefined}
              onClick={() =>
                row.confirmThen(
                  `Reset the password of ${name}? Their password and linked sign-ins stop working, they are signed out, and you get a new link for them.`,
                  async () => onLink(await resetLink.mutateAsync(user.id)),
                )
              }
            >
              <ButtonText size="x-small">Reset password</ButtonText>
            </button>
            <button
              type="button"
              className={ACTION}
              aria-expanded={showSignIns}
              aria-controls={showSignIns ? signInsId : undefined}
              onClick={() => setShowSignIns((shown) => !shown)}
            >
              <ButtonText size="x-small">Sign-ins</ButtonText>
            </button>
            <button
              type="button"
              className={DANGER}
              disabled={row.busy}
              onClick={() => row.confirmThen(deleteQuestion, () => deleteUser.mutateAsync(user.id))}
            >
              <ButtonText size="x-small">Delete</ButtonText>
            </button>
          </div>
        </td>
      </tr>
      {showSignIns && <SignIns user={user} own={own} row={row} id={signInsId} />}
    </>
  );
}

/**
 * The instance admin's Users page (S12–S18): every local account with its role, status and last
 * sign-in; a form that creates a user and shows their one-time link; and per user Make admin or
 * Make user, Disable or Enable, Reset password, their sign-ins with Unlink, and Delete, each after
 * a confirmation. There is no email: the admin sends each link themselves.
 */
export function UsersPage({ currentUserId }: { currentUserId: string }) {
  const { data: users } = useSuspenseQuery(usersQueryOptions);
  const queryClient = useQueryClient();
  const router = useRouter();
  const createUser = useCreateUser();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [shown, setShown] = useState<{ name: string; link: PasswordLink } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The rows with a request in flight: a ref, as two clicks in one tick both see the old render.
  const inFlight = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

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

  const rowActions = (userId: string): RowActions => ({
    busy: busy.has(userId),
    confirmThen: (question, action) => {
      if (inFlight.current.has(userId)) return;
      if (!window.confirm(question)) return;
      inFlight.current.add(userId);
      setBusy(new Set(inFlight.current));
      void run(action, "Could not change the user. Please try again.").finally(() => {
        inFlight.current.delete(userId);
        setBusy(new Set(inFlight.current));
      });
    },
  });

  /** After the admin made themselves a user: the guard reads the role again, and the page goes. */
  const demotedSelf = async () => {
    queryClient.removeQueries({ queryKey: currentUserQueryOptions.queryKey });
    await router.invalidate();
  };

  return (
    <article className="v2-class---my-surveys-page">
      <div className={PAGE}>
        <PageHeader title="Users" />
        <p className="v2-class---paragraph">
          Create a user to get a one-time link that sets their password, and send it to them
          yourself. Instance admins manage the users and every project.
        </p>

        <form
          className={styles.create}
          onSubmit={(event) => {
            event.preventDefault();
            if (createUser.isPending) return;
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
            <span className="v2-class---checkbox__label">Instance admin</span>
          </label>
          <button type="submit" className={PRIMARY} disabled={createUser.isPending}>
            <ButtonText size="medium">Create user</ButtonText>
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
                <th scope="col">User</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Last sign-in</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  own={user.id.toLowerCase() === currentUserId.toLowerCase()}
                  row={rowActions(user.id)}
                  onLink={(link) => setShown({ name: user.displayName, link })}
                  onDemotedSelf={demotedSelf}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  );
}

/** The page for a signed-in user who is not an instance admin. */
export function UsersNotAllowed() {
  return (
    <article className="v2-class---my-surveys-page">
      <div className={PAGE}>
        <PageHeader title="Users" />
        <p className="v2-class---paragraph">Only instance admins can manage users.</p>
      </div>
    </article>
  );
}
