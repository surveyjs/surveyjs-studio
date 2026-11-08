import { createLazyFileRoute, getRouteApi } from "@tanstack/react-router";
import { SignInPage } from "../account/SignInPage";
import { LazySandboxSignIn } from "../sandboxLazy";
import { renderAnonymousPage } from "../shell/registry";

export const Route = createLazyFileRoute("/sign-in")({
  component: SignIn,
});

const rootRoute = getRouteApi("__root__");

function SignIn() {
  const { returnTo } = Route.useSearch();
  const config = rootRoute.useLoaderData();
  // Inline, so the bundler removes the picker from the normal build.
  if (import.meta.env.MODE === "sandbox") {
    return renderAnonymousPage(config, <LazySandboxSignIn returnTo={returnTo} />);
  }
  return renderAnonymousPage(
    config,
    <SignInPage returnTo={returnTo} methods={config.authMethods} />,
  );
}
