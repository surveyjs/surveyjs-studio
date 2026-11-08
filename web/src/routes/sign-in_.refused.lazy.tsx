import { createLazyFileRoute, getRouteApi } from "@tanstack/react-router";
import { SignInRefusedPage } from "../account/SignInRefusedPage";
import { renderAnonymousPage } from "../shell/registry";

export const Route = createLazyFileRoute("/sign-in_/refused")({
  component: SignInRefused,
});

const rootRoute = getRouteApi("__root__");

function SignInRefused() {
  const { reason, provider } = Route.useSearch();
  const config = rootRoute.useLoaderData();
  return renderAnonymousPage(config, <SignInRefusedPage reason={reason} provider={provider} />);
}
