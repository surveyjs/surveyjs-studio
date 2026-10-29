import { createLazyFileRoute, getRouteApi } from "@tanstack/react-router";
import { ChangePasswordPage } from "../../account/ChangePasswordPage";
import { PasswordsNotUsed } from "../../account/PasswordsNotUsed";

export const Route = createLazyFileRoute("/_private/change-password")({
  component: ChangePassword,
});

const rootRoute = getRouteApi("__root__");

function ChangePassword() {
  const { returnTo } = Route.useSearch();
  const { user } = Route.useRouteContext();
  const config = rootRoute.useLoaderData();
  if (!config.authMethods.includes("password")) {
    return <PasswordsNotUsed title="Change your password" />;
  }
  return <ChangePasswordPage returnTo={returnTo} forced={user.mustChangePassword === true} />;
}
