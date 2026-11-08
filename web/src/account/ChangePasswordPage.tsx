import { useState } from "react";
import { passwordErrorMessage, useChangeOwnPassword } from "../api/passwords";
import { navigateTo } from "../navigation";
import { PageHeader } from "../surveyList/PageHeader";
import { AccountForm, AccountPage, Field } from "./AccountForm";
import { appPath } from "./returnTo";

/**
 * Changes the signed-in user's password; also the forced change after a first sign-in with a
 * password someone else chose (`mustChangePassword`), which the private layout sends here. The
 * server ends every other session of the user and answers with a new one; the app then reloads at
 * `returnTo`, so the user read before the change is not used again.
 */
export function ChangePasswordPage({
  returnTo,
  forced,
}: {
  returnTo: string | undefined;
  forced: boolean;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const change = useChangeOwnPassword();

  const submit = async () => {
    if (newPassword !== repeated) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    try {
      await change.mutateAsync({ currentPassword, newPassword });
      navigateTo(appPath(returnTo));
    } catch {
      // Shown from the mutation's error.
    }
  };

  const error = mismatch
    ? "The new passwords do not match."
    : change.error
      ? passwordErrorMessage(change.error, "Could not change the password. Please try again.")
      : null;

  return (
    <AccountPage>
      <PageHeader title="Change your password" />
      {forced && (
        <p className="v2-class---paragraph">
          You signed in with a password someone else chose. You must choose a new password before
          you continue.
        </p>
      )}
      <AccountForm
        submitText="Change password"
        pending={change.isPending}
        error={error}
        onSubmit={submit}
      >
        <Field
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={setCurrentPassword}
        />
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={setNewPassword}
        />
        <Field
          label="Repeat the new password"
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
