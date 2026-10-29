import { createLazyFileRoute } from "@tanstack/react-router";
import { ChangePasswordPage } from "../../account/ChangePasswordPage";

export const Route = createLazyFileRoute("/_private/change-password")({
  component: ChangePassword,
});

function ChangePassword() {
  const { returnTo } = Route.useSearch();
  const { user } = Route.useRouteContext();
  return <ChangePasswordPage returnTo={returnTo} forced={user.mustChangePassword === true} />;
}
