import { createFileRoute } from "@tanstack/react-router";
import { searchText } from "../../account/returnTo";

/** Change password (`/change-password?returnTo=`), also the forced change (see `_private`). */
export const Route = createFileRoute("/_private/change-password")({
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } => ({
    returnTo: searchText(search["returnTo"]),
  }),
});
