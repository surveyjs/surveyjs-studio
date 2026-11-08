import { useState } from "react";
import { passwordErrorMessage, useSetPasswordWithLink } from "../api/passwords";
import { navigateTo } from "../navigation";
import { PageHeader } from "../surveyList/PageHeader";
import { AccountForm, AccountPage, Field } from "./AccountForm";

/**
 * The page of a one-time link. `?setup=` is the first admin's setup link, which the server writes
 * to its log while the instance has no admin: it asks for the admin's email, name and password.
 * `?token=` sets the password of an existing account. A link works once. The server signs the
 * user in with the new password (S19), so the app reloads at My Surveys; an account that may not
 * sign in (disabled) lands on the sign-in page from there.
 */
export function SetPasswordPage({
  setup,
  token,
}: {
  setup: string | undefined;
  token: string | undefined;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const link = useSetPasswordWithLink();
  const firstAdmin = setup !== undefined;
  const linkToken = setup ?? token;

  if (linkToken === undefined || linkToken === "") {
    return (
      <AccountPage>
        <PageHeader title="Set your password" />
        <p className="v2-class---paragraph">
          This link is not complete. Open the whole link you were given, or ask for a new one.
        </p>
      </AccountPage>
    );
  }

  if (link.isSuccess) {
    return (
      <AccountPage>
        <PageHeader title={firstAdmin ? "Create the first admin" : "Set your password"} />
        <p className="v2-class---paragraph">
          {firstAdmin ? "The admin was created." : "Your password was set."} Opening My Surveys…
        </p>
      </AccountPage>
    );
  }

  const submit = async () => {
    if (password !== repeated) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    try {
      await link.mutateAsync(
        firstAdmin
          ? { token: linkToken, password, email: email.trim(), displayName: displayName.trim() }
          : { token: linkToken, password },
      );
      navigateTo("/");
    } catch {
      // Shown from the mutation's error.
    }
  };

  const error = mismatch
    ? "The passwords do not match."
    : link.error
      ? passwordErrorMessage(link.error, "Could not set the password. Please try again.")
      : null;

  return (
    <AccountPage>
      <PageHeader title={firstAdmin ? "Create the first admin" : "Set your password"} />
      {firstAdmin && (
        <p className="v2-class---paragraph">
          This instance has no admin yet. The admin manages the instance&apos;s users.
        </p>
      )}
      <AccountForm
        submitText={firstAdmin ? "Create the admin" : "Set password"}
        pending={link.isPending}
        error={error}
        onSubmit={submit}
      >
        {firstAdmin && (
          <>
            <Field
              label="Email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={setEmail}
            />
            <Field
              label="Name"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={setDisplayName}
            />
          </>
        )}
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
        />
        <Field
          label="Repeat the password"
          type="password"
          autoComplete="new-password"
          value={repeated}
          onChange={setRepeated}
        />
      </AccountForm>
      <p className="v2-class---paragraph">
        Use at least 12 characters. A few words make a password that is long and easy to remember.
      </p>
    </AccountPage>
  );
}
