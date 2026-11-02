import { createLazyFileRoute, getRouteApi } from "@tanstack/react-router";
import { SignInPage } from "../account/SignInPage";
import { renderAnonymousPage } from "../shell/registry";

export const Route = createLazyFileRoute("/sign-in")({
  component: SignIn,
});

const rootRoute = getRouteApi("__root__");

function SignIn() {
  const { returnTo } = Route.useSearch();
  const config = rootRoute.useLoaderData();
  return renderAnonymousPage(
    config,
    <SignInPage returnTo={returnTo} methods={config.authMethods} />,
  );
}
