import { useState } from "react";
import { passwordErrorMessage, usePasswordLogin } from "../api/passwords";
import { navigateTo } from "../navigation";
import { PageHeader } from "../surveyList/PageHeader";
import { AccountForm, Field } from "./AccountForm";
import { EXTERNAL_SIGN_IN_LABELS, isExternalMethod, type AuthMethod } from "./authMethods";
import { appPath } from "./returnTo";

/**
 * The sign-in page: the email and password form when `password` is a method, then one link per
 * external method (surveyjs.io, Google, GitHub, Facebook) in AUTH_METHODS order. A successful sign-in reloads the app at `returnTo`,
 * so nothing cached for the signed-out visitor stays.
 */
export function SignInPage({
  returnTo,
  methods,
}: {
  returnTo: string | undefined;
  methods: readonly AuthMethod[];
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

  const withPassword = methods.includes("password");
  const external = methods.filter(isExternalMethod);

  return (
    <>
      <PageHeader title="Sign in" />
      {withPassword && (
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
      )}
      {withPassword && external.length > 0 && <p className="v2-class---paragraph">or</p>}
      {external.map((method) => (
        <p key={method} className="v2-class---paragraph">
          <a
            className="v2-class---paragraph-link"
            href={`/api/v1/auth/login?provider=${method}&returnTo=${encodeURIComponent(target)}`}
          >
            {EXTERNAL_SIGN_IN_LABELS[method]}
          </a>
        </p>
      ))}
    </>
  );
}
