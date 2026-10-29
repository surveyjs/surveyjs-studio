import { createFileRoute } from "@tanstack/react-router";
import { usersQueryOptions } from "../../../api/admin";

/** The instance admin's Users page (`/admin/users`): the page component is in users.lazy.tsx. */
export const Route = createFileRoute("/_private/admin/users")({
  loader: ({ context: { queryClient, user } }) =>
    user.instanceRole === "admin" ? queryClient.ensureQueryData(usersQueryOptions) : null,
});
