import { createLazyFileRoute, getRouteApi } from "@tanstack/react-router";
import { SignInPage } from "../account/SignInPage";
import { AnonymousShell } from "../shell/PlainShell";
import { renderShellStyles } from "../shell/registry";

export const Route = createLazyFileRoute("/sign-in")({
  component: SignIn,
});

const rootRoute = getRouteApi("__root__");

function SignIn() {
  const { returnTo } = Route.useSearch();
  const config = rootRoute.useLoaderData();
  return renderShellStyles(
    config.shell,
    <AnonymousShell>
      <SignInPage returnTo={returnTo} offerSurveyjs={config.authMethods.includes("surveyjs")} />
    </AnonymousShell>,
  );
}
