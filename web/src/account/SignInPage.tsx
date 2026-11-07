import { useState } from "react";
import { passwordErrorMessage, usePasswordLogin } from "../api/passwords";
import { navigateTo } from "../navigation";
import { PageHeader } from "../surveyList/PageHeader";
import { AccountForm, Field } from "./AccountForm";
import { appPath } from "./returnTo";

/**
 * The sign-in page of an instance with passwords (AUTH_METHODS=password): email and password, and
 * the SurveyJS sign-in too when it is configured. A successful sign-in reloads the app at `returnTo`,
 * so nothing cached for the signed-out visitor stays.
 */
export function SignInPage({
  returnTo,
  offerSurveyjs,
}: {
  returnTo: string | undefined;
  offerSurveyjs: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = usePasswordLogin();
  const target = appPath(returnTo);

  const submit = async () => {
    try {
      await login.mutateAsync({ email: email.trim(), password });
      navigateTo(target);
    } catch {
      // Shown from the mutation's error.
    }
  };

  return (
    <>
      <PageHeader title="Sign in" />
      <AccountForm
        submitText="Sign in"
        pending={login.isPending}
        error={
          login.error
            ? passwordErrorMessage(login.error, "Could not sign in. Please try again.")
            : null
        }
        onSubmit={submit}
      >
        <Field
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={setEmail}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
      </AccountForm>
      {offerSurveyjs && (
        <p className="v2-class---paragraph">
          <a
            className="v2-class---paragraph-link"
            href={`/api/v1/auth/login?returnTo=${encodeURIComponent(target)}`}
          >
            Sign in with SurveyJS
          </a>
        </p>
      )}
    </>
  );
}
