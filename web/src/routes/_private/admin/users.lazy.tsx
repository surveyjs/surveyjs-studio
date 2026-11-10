import { createLazyFileRoute } from "@tanstack/react-router";
import { UsersNotAllowed, UsersPage } from "../../../admin/UsersPage";

export const Route = createLazyFileRoute("/_private/admin/users")({ component: Users });

function Users() {
  const { user } = Route.useRouteContext();
  return user.instanceRole === "admin" ? (
    <UsersPage currentUserId={user.id} />
  ) : (
    <UsersNotAllowed />
  );
}
