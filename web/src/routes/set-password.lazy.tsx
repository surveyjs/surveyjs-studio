import { createLazyFileRoute, getRouteApi } from "@tanstack/react-router";
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
      <SetPasswordPage setup={setup} token={token} />
    </AnonymousShell>,
  );
}
