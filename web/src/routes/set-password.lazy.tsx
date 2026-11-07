import { createLazyFileRoute, getRouteApi } from "@tanstack/react-router";
import { PasswordsNotUsed } from "../account/PasswordsNotUsed";
import { SetPasswordPage } from "../account/SetPasswordPage";
import { AnonymousShell } from "../shell/PlainShell";
import { renderShellStyles } from "../shell/registry";

export const Route = createLazyFileRoute("/set-password")({
  component: SetPassword,
});

const rootRoute = getRouteApi("__root__");

function SetPassword() {
  const { setup, token } = Route.useSearch();
  const config = rootRoute.useLoaderData();
  return renderShellStyles(
    config.shell,
    <AnonymousShell>
      {config.authMethods.includes("password") ? (
        <SetPasswordPage setup={setup} token={token} />
      ) : (
        <PasswordsNotUsed title="Set your password" />
      )}
    </AnonymousShell>,
  );
}
