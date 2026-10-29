import { createFileRoute } from "@tanstack/react-router";
import { searchText } from "../account/returnTo";

/**
 * The sign-in page of an instance with passwords (`/sign-in?returnTo=`). It sits outside
 * `_private`: the visitor is not signed in yet.
 */
export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } => ({
    returnTo: searchText(search["returnTo"]),
  }),
});
